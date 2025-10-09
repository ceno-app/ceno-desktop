#include <filesystem>
#include <string>

#include <windows.h>
#include <shellapi.h>
#include <strsafe.h>
#include <CommCtrl.h>

#include <ouinet_client.h>

#include "Resource.h"


static HINSTANCE g_hInst = NULL;

static DWORD g_guiThreadId;

static int g_exitCode = EXIT_FAILURE;
static bool g_isOuinetRunning = false;

static constexpr UINT g_notificationCallbackMessage = WM_APP + 1;
static constexpr UINT g_notificationIconUid = 1;

static constexpr UINT g_ouinetThreadExitedMessage = WM_APP + 2;

static constexpr std::wstring_view g_cenoExecutableFilename { L"ceno-alpha.exe" };
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

void onOuinetExit(const int exit_code) {
  g_isOuinetRunning = false;
  g_exitCode = exit_code;
  if (!PostThreadMessage(g_guiThreadId, g_ouinetThreadExitedMessage, 0, 0)) {
    exit(exit_code);
  }
}

// ceno.exe is in the parent directory of this file
static std::wstring getCenoExecutablePath(HINSTANCE hInstance) {
  WCHAR moduleFilepath[MAX_PATH];
  // C:\ceno-alpha\Ouinet\ceno-network-client.exe
  size_t length = GetModuleFileName(hInstance, moduleFilepath, MAX_PATH);
  if (length == 0) {
    return L"";
  }
  // C:\ceno-alpha\ceno-alpha.exe
  return std::filesystem::path { moduleFilepath }.parent_path().parent_path().append(g_cenoExecutableFilename).wstring();
}

int APIENTRY wWinMain(HINSTANCE hInstance, HINSTANCE, LPWSTR /* ouinetClientArguments */, int /*nCmdShow*/) {
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
  g_cenoExecutablePath = getCenoExecutablePath(hInstance);
  if (g_cenoExecutablePath.length() <= g_cenoExecutableFilename.length() + 1) {
    ShowError(L"Failed to get Ceno executable path", L"");
    return 1;
  }

  const int ouinetStartupValue = ouinet_client_run(__argc, __argv, onOuinetExit);
  if (0 == ouinetStartupValue) {
    g_isOuinetRunning = true;
  } else {
    ShowErrorA("Failed to start Ceno Network Client: ", ouinet_client_get_error());
    return ouinetStartupValue;
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

  if (g_isOuinetRunning) {
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
