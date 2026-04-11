#include <array>
#include <atomic>
#include <format>
#include <fstream>
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
// 1: Receive WM_CLOSE
// 2: ouinet_client_stop() request
// 3: onOuinetExit() callback is executed
// 4: sending ouinetDidExitMessage to GUI thread
// 5: PostQuitMessage() in GUI thread

static constexpr UINT notificationCallbackMessage = WM_APP + 1;
static constexpr UINT ouinetDidExitMessage = WM_APP + 2;

static HINSTANCE hInstance{};

std::atomic<HWND> windowHandleForCommunicatingFromOtherThreads { NULL };

static ArgvConverter *args;
static std::optional<std::filesystem::path> exitCookie;

static std::filesystem::path cenoExecutablePath;

static bool notificationShown { false };
static std::array<NOTIFYICONDATA, 6> icons {};
constexpr int ICON_CONNECTING = 0;
constexpr int ICON_DEGRADED = 1;
constexpr int ICON_CONNECTED = 2;
constexpr int ICON_EXITING = 3;
constexpr int ICON_RESTARTING = 4;
constexpr int ICON_OFFLINE = 5;

static std::atomic_flag exitRequested;
static std::atomic_flag isRestarting;

enum OuinetState {
    Created = 0,  // not told to start yet (initial)
    Failed,  // told to start, error precludes from continuing (final)
    Starting,  // told to start, some operations still pending completion
    Degraded,  // told to start, some operations succeeded but others failed
    Started,  // told to start, all operations succeeded
    Stopping,  // told to stop, some operations still pending completion
    Stopped,  // told to stop, all operations succeeded (final)
};
static int ouinet_state = OuinetState::Created;

static LRESULT CALLBACK windowProcedure(HWND hWnd, UINT message, WPARAM wParam, LPARAM lParam);
static void updateNotificationIcon(int iconId);

HWND createGuiWindow(HINSTANCE _hInstance, ArgvConverter *_args) {
    hInstance = _hInstance;
    args = _args;

    cenoExecutablePath = args->ceno_network_client_path.value().parent_path().parent_path().append(L"ceno-alpha.exe");
    if (args->repo_path.has_value()) {
        exitCookie = args->repo_path.value() / "exitCookie";
        std::error_code ec;
        std::filesystem::remove(exitCookie.value(), ec);
    }

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


static void requestToCloseProgram(HWND hWnd) {
    isRestarting.clear();

    // If asked twice, don't wait for ouinet to exit by itself.
    // Cleanup GUI program and exit(EXIT_FAILURE);
    if (exitRequested.test_and_set()) {
        g_ouinetIsStuckOnExit_ForceExitInMain.test_and_set();
        if (!PostMessage(hWnd, ouinetDidExitMessage, 0, 0)) {
            ShowError(L"Failed to close Ceno Network Client: ", GetLastErrorAsWString());
            exit(EXIT_FAILURE);
        }
    } else {
        updateNotificationIcon(ICON_EXITING);
        // @TODO: update this once ouinet can be stopped at startup
        if (ouinet_state == OuinetState::Degraded ||
            ouinet_state == OuinetState::Started
        ) {
            stopStatePoller();
            ouinet_client_stop_and_detach();
        }
    }
}

static void requestToRestartProgram() {
    if (exitRequested.test()) {
        return;
    }

    if (!isRestarting.test_and_set()) {
        updateNotificationIcon(ICON_RESTARTING);
        // @TODO: update this once ouinet can be stopped at startup
        if (ouinet_state == OuinetState::Degraded ||
            ouinet_state == OuinetState::Started
        ) {
            stopStatePoller();
            ouinet_client_stop_and_detach();
        }
    }
}

// onOuinetExit is executed by ouinet's thread
static void onOuinetExit(const int exit_code) {
    g_exitCode = exit_code;

    if (const std::string_view err = ouinet_client_get_error(); !err.empty()) {
        ShowErrorA(err, "");
    }

    HWND hWnd = windowHandleForCommunicatingFromOtherThreads.load();
    if (hWnd == NULL || !PostMessage(hWnd, ouinetDidExitMessage, 0, 0)) {
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
        load(icons[ICON_DEGRADED], IDS_TOOLTIP_DEGRADED, IDI_ICON_ACTIVE) &&
        load(icons[ICON_CONNECTED], IDS_TOOLTIP_CONNECTED, IDI_ICON_ACTIVE) &&
        load(icons[ICON_EXITING], IDS_TOOLTIP_EXITING, IDI_ICON_GRAY) &&
        load(icons[ICON_RESTARTING], IDS_TOOLTIP_RESTARTING, IDI_ICON_GRAY) &&
        load(icons[ICON_OFFLINE], IDS_TOOLTIP_OFFLINE, IDI_ICON_ACTIVE);
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

static void removeNotificationIcon() {
    if (notificationShown) {
        Shell_NotifyIcon(NIM_DELETE, &icons[ICON_EXITING]);
    }
    notificationShown = false;
}

static void onOuinetStateChange(const int ouinetState, const bool isOnline) {
    ouinet_state = ouinetState;

    if ((ouinet_state == OuinetState::Degraded ||
        ouinet_state == OuinetState::Started ) && (
        exitRequested.test() || isRestarting.test()
    )) {
        stopStatePoller();
        ouinet_client_stop_and_detach();
        return;
    }

    int icon;
    switch (ouinetState) {
    case OuinetState::Created:
    case OuinetState::Starting:
        icon = ICON_CONNECTING;
        break;
    case OuinetState::Degraded:
        icon = isOnline ? ICON_DEGRADED : ICON_OFFLINE;
        break;
    case OuinetState::Started:
        icon = ICON_CONNECTED;
        break;
    // OuinetState::Failed
    // OuinetState::Stopping
    // OuinetState::Stopped
    default:
        icon = isRestarting.test() ? ICON_RESTARTING : ICON_EXITING;
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

// Ceno Browser needs to know if CenoNetworkClient is unresponsive because it's trying to exit
static void writeExitCookie() {
    if (!exitCookie.has_value())
        return;

    std::ofstream stream {exitCookie.value()};
    if (!stream.good())
        return;
    stream << "1";
    stream.close();
}

static LRESULT CALLBACK windowProcedure(HWND hWnd, const UINT message, const WPARAM wParam, const LPARAM lParam) {
    static WPARAM connectionId = 0;
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
            writeExitCookie();
            requestToCloseProgram(hWnd);
            break;
        default:
            return DefWindowProc(hWnd, message, wParam, lParam);
        }
    }
    break;
    case WM_CLOSE:
        writeExitCookie();
        if (windowHandleForCommunicatingFromOtherThreads.load() != NULL) {
            requestToCloseProgram(hWnd);
        } else {
            removeNotificationIcon();
            PostQuitMessage(g_exitCode);
        }
        break;
    case ouinetDidExitMessage:
        if (isRestarting.test()) {
            isRestarting.clear();
            const auto now = std::chrono::steady_clock::now();
            if (EXIT_SUCCESS != ouinet_client_run(args->argc, args->argv.data(), onOuinetExit)) {
                ShowErrorA("Failed to restart Ceno Network Client:", ouinet_client_get_error());
                removeNotificationIcon();
                g_exitCode = 1;
                PostQuitMessage(g_exitCode);
                windowHandleForCommunicatingFromOtherThreads = NULL;
            }
            connectionId++;
            startStatePoller(connectionId, now);
            break;
        }
        [[fallthrough]];
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
        {
            const auto now = std::chrono::steady_clock::now();
            if (EXIT_SUCCESS != ouinet_client_run(args->argc, args->argv.data(), onOuinetExit))
                return -1;
            startStatePoller(connectionId, now);
        }
        break;
    case ouinetStateChange:
        if (wParam == connectionId) {
            const int ouinetState = unpackOuinetState(lParam);
            const bool internetState = unpackInternetState(lParam);
            onOuinetStateChange(ouinetState, internetState);
        }
        break;
    case networkAddressChange:
        if (!exitRequested.test() && !isRestarting.test()) {
            requestToRestartProgram();
        }
        break;
    default:
        return DefWindowProc(hWnd, message, wParam, lParam);
    }
    return 0;
}
