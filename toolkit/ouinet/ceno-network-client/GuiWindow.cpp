#include <array>
#include <atomic>
#include <format>
#include <thread>

#include <windows.h>
#include <shellapi.h>
#include <strsafe.h>
#include <CommCtrl.h>

#include "client_lib.h"
#include "ErrorUtils.h"
#include "GuiWindow.h"
#include "Resource.h"
#include "StatePoller.h"

static constexpr UINT notificationIconUid = 1;

// Order of closing:
// 1: WM_CLOSE receival
// 2: ouinet_client_stop request
// 3: onOuinetExit callback is executed
// 4: sending ouinetDidExitMessage to GUI thread
// 5: PostQuitMessage() in GUI thread

static constexpr UINT notificationCallbackMessage = WM_APP + 1;
static constexpr UINT ouinetDidExitMessage = WM_APP + 2;

static HINSTANCE hInstance{};

std::atomic<HWND> windowHandleForCommunicatingFromOtherThreads { NULL };

static ArgvConverter *args;

static std::filesystem::path cenoExecutablePath;

static bool notificationShown { false };
static std::array<NOTIFYICONDATA, 4> icons {};
constexpr int ICON_CONNECTING = 0;
constexpr int ICON_DEGRADED = 1;
constexpr int ICON_CONNECTED = 2;
constexpr int ICON_EXITING = 3;

static std::atomic_flag exitRequested;

static LRESULT CALLBACK windowProcedure(HWND hWnd, UINT message, WPARAM wParam, LPARAM lParam);

HWND createGuiWindow(HINSTANCE _hInstance, ArgvConverter *_args) {
    hInstance = _hInstance;
    args = _args;

    cenoExecutablePath = args->ceno_network_client_path.value().parent_path().parent_path().append(L"ceno-alpha.exe");

    constexpr wchar_t windowClassName[] = L"CenoNetworkClientWindowClass";

    const WNDCLASSEX windowClassEX = {
      .cbSize = sizeof(windowClassEX),
      .lpfnWndProc = windowProcedure,
      .hInstance = hInstance,
      .lpszClassName = windowClassName,
    };

    if (0 == RegisterClassEx(&windowClassEX)) {
        ShowError(L"Failed to register window class:", GetLastErrorAsWString());
        return NULL;
    }

    HWND windowHandle = CreateWindowEx(0, windowClassName, windowClassName, 0, 0, 0, 0, 0, NULL, NULL, hInstance, NULL);
    // Check if creation was not aborted, due to error in tray icon or ouinet startup
    if (NULL == windowHandle && 0 != GetLastError()) {
        ShowError(L"Failed to create window:", GetLastErrorAsWString());
    }
    return windowHandle;
}

static void updateNotificationIcon(int iconId);
static void requestToCloseProgram(HWND hWnd) {
    stopStatePoller();
    updateNotificationIcon(ICON_EXITING);

    // If asked twice, don't wait for ouinet to exit by itself.
    // Cleanup GUI program and exit(EXIT_FAILURE);
    if (exitRequested.test_and_set()) {
        g_ouinetIsStuckOnExit_ForceExitInMain.test_and_set();
        if (!PostMessage(hWnd, ouinetDidExitMessage, 0, 0)) {
            ShowError(L"Failed to close Ceno Network Client: ", GetLastErrorAsWString());
            exit(EXIT_FAILURE);
        }
    } else {
        ouinet_client_stop_and_detach();
    }
}

// onOuinetExit is executed by ouinet's thread
static void onOuinetExit(const int exit_code) {
    g_exitCode = exit_code;

    if (const std::string_view err = ouinet_client_get_error(); !err.empty()) {
        ShowErrorA(err, "");
    }

    if (!PostMessage(windowHandleForCommunicatingFromOtherThreads, ouinetDidExitMessage, 0, 0)) {
        ShowError(L"Failed to close Ceno Network Client: ", GetLastErrorAsWString());
        exit(EXIT_FAILURE);
    }
}

static bool loadIcons(HWND hWnd) {
    auto load = [=](auto &icon, const int tooltip_res_id, const int icon_res_id) {
        icon.cbSize = sizeof(icon);
        icon.hWnd = hWnd;
        icon.uID = notificationIconUid;
        icon.uFlags = NIF_ICON | NIF_TIP | NIF_MESSAGE | NIF_SHOWTIP;
        icon.uCallbackMessage = notificationCallbackMessage;
        icon.uVersion = NOTIFYICON_VERSION_4;
        if (0 == LoadString(hInstance, tooltip_res_id, icon.szTip, ARRAYSIZE(icon.szTip))) {
            ShowError(L"Failed to load system tray icon tooltip:", GetLastErrorAsWString());
            return false;
        }
        if (FAILED(LoadIconMetric(hInstance, MAKEINTRESOURCE(icon_res_id), LIM_SMALL, &icon.hIcon))) {
            ShowError(L"Failed to load system tray icon:", GetLastErrorAsWString());
            return false;
        }
        return true;
    };

    return
        load(icons[ICON_CONNECTING], IDS_TOOLTIP_CONNECTING, IDI_ICON_GRAY) &&
        load(icons[ICON_DEGRADED], IDS_TOOLTIP_DEGRADED, IDI_ICON_GRAY) &&
        load(icons[ICON_CONNECTED], IDS_TOOLTIP_CONNECTED, IDI_ICON_ACTIVE) &&
        load(icons[ICON_EXITING], IDS_TOOLTIP_EXITING, IDI_ICON_GRAY);
}

static bool createNotificationIcon(HWND hWnd) {
    if (!Shell_NotifyIcon(NIM_ADD, &icons[ICON_CONNECTING])) {
        ShowError(L"Failed to show system tray icon:", GetLastErrorAsWString());
        return false;
    }
    notificationShown = true;
    if (!Shell_NotifyIcon(NIM_SETVERSION, &icons[ICON_CONNECTING])) {
        ShowError(L"Failed to show system tray icon:", GetLastErrorAsWString());
        return false;
    }
    return true;
}

static void updateNotificationIcon(const int iconId) {
    if (!Shell_NotifyIcon(NIM_MODIFY, &icons[iconId])) {
        ShowError(L"Failed to show system tray icon:", GetLastErrorAsWString());
    }
}

void removeNotificationIcon() {
    if (notificationShown) {
        Shell_NotifyIcon(NIM_DELETE, &icons[ICON_EXITING]);
    }
    notificationShown = false;
}

static void onOuinetStateChange(const int ouinetState) {
    /*
    case ouinet::Client::RunningState::Created: state = 0;
    case ouinet::Client::RunningState::Failed: state = 1;
    case ouinet::Client::RunningState::Starting: state = 2;
    case ouinet::Client::RunningState::Degraded: state = 3;
    case ouinet::Client::RunningState::Started: state = 4;
    case ouinet::Client::RunningState::Stopping: state = 5;
    case ouinet::Client::RunningState::Stopped: state = 6;
    */
    int icon;
    switch (ouinetState) {
    case 0:
    case 2:
        icon = ICON_CONNECTING;
        break;
    case 3:
        icon = ICON_DEGRADED;
        break;
    case 4:
        icon = ICON_CONNECTED;
        break;
    default:
        icon = ICON_EXITING;
        break;
    }
    updateNotificationIcon(icon);
}

static void openCeno(HWND hWnd) {
    if (32 > (INT_PTR)ShellExecute(hWnd, L"open", cenoExecutablePath.c_str(), NULL, NULL, SW_NORMAL)) {
        ShowError(std::format(L"Failed to open Ceno Browser. {}: ", GetLastErrorAsWString()), cenoExecutablePath.wstring());
    }
}

static void showContextMenu(HWND hWnd, POINT pt) {
    if (HMENU hMenu = LoadMenu(hInstance, MAKEINTRESOURCE(IDC_CONTEXTMENU))) {
        if (HMENU hSubMenu = GetSubMenu(hMenu, 0)) {
            // our window must be foreground before calling TrackPopupMenu or the menu will not disappear when the user clicks away
            SetForegroundWindow(hWnd);

            // respect menu drop alignment
            UINT uFlags = TPM_RIGHTBUTTON;
            if (GetSystemMetrics(SM_MENUDROPALIGNMENT) != 0) {
                uFlags |= TPM_RIGHTALIGN;
            }
            else {
                uFlags |= TPM_LEFTALIGN;
            }
            TrackPopupMenuEx(hSubMenu, uFlags, pt.x, pt.y, hWnd, NULL);
        }
        DestroyMenu(hMenu);
    }
}

static LRESULT CALLBACK windowProcedure(HWND hWnd, UINT message, WPARAM wParam, LPARAM lParam) {
    switch (message) {
    case notificationCallbackMessage:
        switch (LOWORD(lParam)) {
        case NIN_SELECT:
            openCeno(hWnd);
            break;
        case WM_CONTEXTMENU:
            {
                POINT const pt = { LOWORD(wParam), HIWORD(wParam) };
                showContextMenu(hWnd, pt);
            }
            break;
        default:
            return DefWindowProc(hWnd, message, wParam, lParam);
        }
        break;
    case WM_COMMAND: {
        switch (LOWORD(wParam)) {
        case IDM_OPEN:
            openCeno(hWnd);
            break;
        case IDM_EXIT:
            requestToCloseProgram(hWnd);
            break;
        default:
            return DefWindowProc(hWnd, message, wParam, lParam);
        }
    }
    break;
    case WM_CLOSE:
        requestToCloseProgram(hWnd);
        break;
    case ouinetDidExitMessage:
    case WM_DESTROY:
        removeNotificationIcon();
        PostQuitMessage(g_exitCode);
        windowHandleForCommunicatingFromOtherThreads = NULL;
        break;
    case WM_CREATE:
        windowHandleForCommunicatingFromOtherThreads = hWnd;
        if (!loadIcons(hWnd))
            return -1;
        if (!createNotificationIcon(hWnd))
            return -1;
        if (EXIT_SUCCESS != ouinet_client_run(args->argc, args->argv.data(), onOuinetExit))
            return -1;
        args->cleanup();
        startStatePoller();
        break;
    case ouinetStateChange:
        onOuinetStateChange((int)wParam);
        break;
    default:
        return DefWindowProc(hWnd, message, wParam, lParam);
    }
    return 0;
}
