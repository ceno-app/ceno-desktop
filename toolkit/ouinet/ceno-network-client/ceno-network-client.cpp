#include <filesystem>
#include <format>
#include <latch>
#include <optional>
#include <string>
#include <thread>

#include <windows.h>
#include <shellapi.h>
#include <strsafe.h>
#include <CommCtrl.h>

#include "Resource.h"

static HINSTANCE g_hInst = NULL;

static DWORD g_guiThreadId;

static int g_exitCode = EXIT_FAILURE;
static std::atomic_flag g_isOuinetRunning {};

static constexpr UINT g_notificationCallbackMessage = WM_APP + 1;
static constexpr UINT g_notificationIconUid = 1;

static constexpr UINT g_ouinetThreadExitedMessage = WM_APP + 2;

static constexpr std::wstring_view g_cenoExecutableFilename { L"ceno-alpha.exe" };
static constexpr std::wstring_view g_ouinetClientExecutableFilename { L"client.exe" };
static std::wstring g_cenoExecutablePath;

LRESULT CALLBACK WindowProcedure(HWND, UINT, WPARAM, LPARAM);
static BOOL AddNotificationIcon(HWND);
static void DeleteNotificationIcon(HWND);
static void ShowContextMenu(HWND hWnd, POINT pt);

// Returns the last Win32 error, in string format. Returns an empty string if there is no error.
// GetLastErrorAsString taken from:
// https://stackoverflow.com/questions/1387064/how-to-get-the-error-message-from-the-error-code-returned-by-getlasterror/17387176#17387176
static std::wstring GetLastErrorAsWString() {
  //Get the error message ID, if any.
  const DWORD errorMessageID = ::GetLastError();
  if (errorMessageID == 0) {
    //No error message has been recorded
    return {};
  }
  LPWSTR messageBuffer = nullptr;
  //Ask Win32 to give us the string version of that message ID.
  //The parameters we pass in, tell Win32 to create the buffer that holds the message for us (because we don't yet know how long the message string will be).
  const size_t size = FormatMessage(
    FORMAT_MESSAGE_ALLOCATE_BUFFER | FORMAT_MESSAGE_FROM_SYSTEM | FORMAT_MESSAGE_IGNORE_INSERTS,
    nullptr, errorMessageID, MAKELANGID(LANG_NEUTRAL, SUBLANG_DEFAULT), (LPWSTR) &messageBuffer, 0, nullptr);

  std::wstring message(messageBuffer, size);
  LocalFree(messageBuffer);
  return message;
}

static void ShowError(const std::wstring_view err_prefix, const std::wstring_view err_msg) {
  const std::wstring::size_type err_len = err_prefix.length() + err_msg.length();
  std::wstring err;
  err.reserve(err_len);
  err += err_prefix;
  err += err_msg;
  MessageBox(NULL, err.data(), L"Ceno Network Client", MB_OK | MB_ICONERROR);
}
static void ShowErrorA(const std::string_view err_prefix, const std::string_view err_msg) {
  const std::string::size_type err_len = err_prefix.length() + err_msg.length();
  std::string err;
  err.reserve(err_len);
  err += err_prefix;
  err += err_msg;
  MessageBoxA(NULL, err.data(), "Ceno Network Client", MB_OK | MB_ICONERROR);
}

static void onOuinetExit(const int exit_code) {
  g_isOuinetRunning.clear();
  g_exitCode = exit_code;
  if (!PostThreadMessage(g_guiThreadId, g_ouinetThreadExitedMessage, 0, 0)) {
    exit(exit_code);
  }
}

static std::optional<std::pair<std::wstring, std::wstring>> getExecutablePaths(HINSTANCE hInstance) {
  WCHAR moduleFilepath[MAX_PATH];

  // C:\ceno-alpha\Ouinet\ceno-network-client.exe
  if (0 == GetModuleFileName(hInstance, moduleFilepath, MAX_PATH)) {
    return {};
  }

  return std::make_pair(
    // ceno.exe is one directory up from ceno-network-client.exe
    std::filesystem::path { moduleFilepath }.parent_path().parent_path().append(g_cenoExecutableFilename).wstring(),
    // ouinet client.exe is in the same directory as ceno-network-client.exe
    std::filesystem::path { moduleFilepath }.parent_path().append(g_ouinetClientExecutableFilename).wstring()
  );
}

static std::latch g_ouinetProcessStarted {1};
static std::atomic_flag g_ouinetProcessStartedSuccessfully {};
static PROCESS_INFORMATION g_ouinetProcessInfo {};

static void ouinet_client_stop() {
  if (0 == AttachConsole(g_ouinetProcessInfo.dwProcessId)) {
    ShowError(L"Failed to attach console to ceno network process: ", GetLastErrorAsWString());
    return;
  }
  if (0 == GenerateConsoleCtrlEvent(CTRL_C_EVENT, g_ouinetProcessInfo.dwProcessId)) {
    ShowError(L"Failed to exit ceno network process: ", GetLastErrorAsWString());
  }
}

static int ouinet_client_run(LPCWSTR ouinet_client_path, LPWSTR arguments) {
  STARTUPINFO startupInfo {
    .cb = sizeof(startupInfo),
  };

  // prepend arguments string with the executable path
  std::wstring argumentsStr {ouinet_client_path};
  argumentsStr += L' ';
  argumentsStr += arguments;

  if (0 == CreateProcess(
    ouinet_client_path,
    argumentsStr.data(),
    NULL, NULL,
    FALSE,
    NORMAL_PRIORITY_CLASS | CREATE_NO_WINDOW,
    NULL,
    NULL,
    &startupInfo,
    &g_ouinetProcessInfo
  )) {
    g_exitCode = 1;
    g_ouinetProcessStartedSuccessfully.clear();
    g_ouinetProcessStarted.count_down();
    return 1;
  }

  // Check if the process does not exit in the first second
  WaitForSingleObject(g_ouinetProcessInfo.hProcess, 1000);
  DWORD exitCode;
  auto rv = GetExitCodeProcess(g_ouinetProcessInfo.hProcess, &exitCode);
  // Failed to get exit code or exit code is not STILL_ACTIVE
  if (0 == rv || STILL_ACTIVE != exitCode) {
    if (0 == rv) {
      exitCode = 1;
    }
    g_exitCode = (int)exitCode;
    g_ouinetProcessStartedSuccessfully.clear();
    g_ouinetProcessStarted.count_down();
    return (int)exitCode;
  }

  // Assuming that process did start successfully
  g_ouinetProcessStartedSuccessfully.test_and_set();
  g_ouinetProcessStarted.count_down();

  WaitForSingleObject(g_ouinetProcessInfo.hProcess, INFINITE);
  if (0 == GetExitCodeProcess(g_ouinetProcessInfo.hProcess, &exitCode)) {
    exitCode = 2;
  }
  onOuinetExit((int)exitCode);
  return 0;
}

int APIENTRY wWinMain(HINSTANCE hInstance, HINSTANCE, LPWSTR ouinetClientArguments, int /*nCmdShow*/) {
  constexpr wchar_t windowClassName[] = L"CenoNetworkClientWindowClass";

  const WNDCLASSEX windowClassEX = {
    .cbSize = sizeof(windowClassEX),
    .lpfnWndProc = WindowProcedure,
    .hInstance = hInstance,
    .lpszClassName = windowClassName,
  };

  if (0 == RegisterClassEx(&windowClassEX)) {
    ShowError(L"Failed to register window class: ", GetLastErrorAsWString());
    return 1;
  }

  g_hInst = hInstance;
  g_guiThreadId = GetCurrentThreadId();
  const auto executablePaths = getExecutablePaths(hInstance);
  if (!executablePaths) {
    ShowError(L"Failed to get Ceno executable path", L"");
    return 1;
  }
  g_cenoExecutablePath = executablePaths->first;
  LPCWSTR ouinetClientExecutablePath = executablePaths->second.c_str();

  std::jthread ouinetThread { ouinet_client_run, ouinetClientExecutablePath, ouinetClientArguments };
  g_ouinetProcessStarted.wait();
  if (g_ouinetProcessStartedSuccessfully.test()) {
    g_isOuinetRunning.test_and_set();
  } else {
    ShowErrorA("Failed to start Ceno Network Client. Error code: ", std::format("{}", g_exitCode));
    return g_exitCode;
  }

  HWND hWnd = CreateWindowEx(0, windowClassName, windowClassName, 0, 0, 0, 0, 0, HWND_MESSAGE, NULL, hInstance, NULL);
  if (NULL == hWnd) {
    ShowError(L"Failed to create window: ", GetLastErrorAsWString());
    return 1;
  }

  MSG msg;
  while (GetMessage(&msg, NULL, 0, 0) > 0) {
    TranslateMessage(&msg);
    DispatchMessage(&msg);

    if (msg.message == g_ouinetThreadExitedMessage) {
      DestroyWindow(hWnd);
    }
  }

  if (g_isOuinetRunning.test()) {
    ouinet_client_stop();
  }
  return g_exitCode;
}

static BOOL AddNotificationIcon(HWND hWnd) {
  NOTIFYICONDATA nid = {
    .cbSize = sizeof(nid),
    .hWnd = hWnd,
    .uID = g_notificationIconUid,
    .uFlags = NIF_ICON | NIF_TIP | NIF_MESSAGE | NIF_SHOWTIP,
    .uCallbackMessage = g_notificationCallbackMessage,
  };
  LoadString(g_hInst, IDS_TOOLTIP, nid.szTip, ARRAYSIZE(nid.szTip));
  if (FAILED(LoadIconMetric(g_hInst, MAKEINTRESOURCE(IDI_NOTIFICATIONICON), LIM_SMALL, &nid.hIcon))) {
    return FALSE;
  }
  if (!Shell_NotifyIcon(NIM_ADD, &nid)) {
    return FALSE;
  }
  nid.uVersion = NOTIFYICON_VERSION_4;
  return Shell_NotifyIcon(NIM_SETVERSION, &nid);
}

static void DeleteNotificationIcon(HWND hWnd) {
  NOTIFYICONDATA nid = {
    .cbSize = sizeof(nid),
    .hWnd = hWnd,
    .uID = g_notificationIconUid,
  };
  Shell_NotifyIcon(NIM_DELETE, &nid);
}

static void OpenCeno(HWND hWnd) {
  if (32 > (INT_PTR) ShellExecute(hWnd, L"open", g_cenoExecutablePath.c_str(), NULL, NULL, SW_NORMAL)) {
    ShowError(L"Failed to open Ceno Browser: ", GetLastErrorAsWString());
  }
}

LRESULT CALLBACK WindowProcedure(HWND hWnd, UINT message, WPARAM wParam, LPARAM lParam) {
  switch (message) {
    case g_notificationCallbackMessage:
      switch (LOWORD(lParam)) {
        case NIN_SELECT:
          OpenCeno(hWnd);
          break;
        case WM_CONTEXTMENU: {
          POINT const pt = {LOWORD(wParam), HIWORD(wParam)};
          ShowContextMenu(hWnd, pt);
        }
        break;
        default:
          return DefWindowProc(hWnd, message, wParam, lParam);
      }
      break;
    case WM_COMMAND: {
      switch (LOWORD(wParam)) {
        case IDM_OPEN:
          OpenCeno(hWnd);
          break;
        case IDM_EXIT:
          DestroyWindow(hWnd);
          break;
        default:
          return DefWindowProc(hWnd, message, wParam, lParam);
      }
    }
    break;
    case WM_DESTROY:
      DeleteNotificationIcon(hWnd);
      PostQuitMessage(0);
      break;
    case WM_CREATE:
      if (!AddNotificationIcon(hWnd)) {
        ShowError(L"Failed to add notification icon: ", GetLastErrorAsWString());
        return 1;
      }
      [[fallthrough]];
    default:
      return DefWindowProc(hWnd, message, wParam, lParam);
  }
  return 0;
}

static void ShowContextMenu(HWND hWnd, POINT pt) {
  if (HMENU hMenu = LoadMenu(g_hInst, MAKEINTRESOURCE(IDC_CONTEXTMENU))) {
    if (HMENU hSubMenu = GetSubMenu(hMenu, 0)) {
      // our window must be foreground before calling TrackPopupMenu or the menu will not disappear when the user clicks away
      SetForegroundWindow(hWnd);

      // respect menu drop alignment
      UINT uFlags = TPM_RIGHTBUTTON;
      if (GetSystemMetrics(SM_MENUDROPALIGNMENT) != 0) {
        uFlags |= TPM_RIGHTALIGN;
      } else {
        uFlags |= TPM_LEFTALIGN;
      }
      TrackPopupMenuEx(hSubMenu, uFlags, pt.x, pt.y, hWnd, NULL);
    }
    DestroyMenu(hMenu);
  }
}
