#include <atomic>
#include <format>

#include <windows.h>
#include <shellapi.h>
#include <strsafe.h>
#include <CommCtrl.h>

#include "ErrorUtils.h"
#include "GuiWindow.h"
#include "Ouinet.h"
#include "Resource.h"

static constexpr UINT notificationIconUid = 1;

// @TODO: exit messages could be better defined
// This is called by external programs, to quit ouinet and then in turn quit gui program
// Keep exitOuinetMessage in sync with terminator program
static constexpr UINT exitOuinetMessage = WM_APP + 1;

// This is called when ouinet exits
static constexpr UINT exitRequestMessage = WM_APP + 2;

static constexpr UINT notificationCallbackMessage = WM_APP + 3;

static HINSTANCE hInstance{};

static std::atomic<HWND> g_windowHandleForClosingFromOtherThread { NULL};

static std::filesystem::path cenoExecutablePath;

static bool notificationShown { false };

static LRESULT CALLBACK windowProcedure(HWND hWnd, UINT message, WPARAM wParam, LPARAM lParam);

HWND createGuiWindow(HINSTANCE _hInstance, const std::filesystem::path &_cenoExecutablePath) {
    hInstance = _hInstance;
    cenoExecutablePath = _cenoExecutablePath;

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
    if (NULL == windowHandle) {
        ShowError(L"Failed to create window:", GetLastErrorAsWString());
        return NULL;
    }

    g_windowHandleForClosingFromOtherThread.store(windowHandle);

    if (const HMENU hMenu = LoadMenu(hInstance, MAKEINTRESOURCE(IDC_CONTEXTMENU))) {
        DestroyMenu(hMenu);
    } else {
        ShowError(L"Failed to find menu resource:", GetLastErrorAsWString());
    }

    return windowHandle;
}

void requestWindowClose() {
    if (FAILED(SendMessage(g_windowHandleForClosingFromOtherThread.load(), exitRequestMessage, 0, 0))) {
        ShowError(L"Failed to remove system tray window: ", GetLastErrorAsWString());
    }
}

bool createNotificationIcon(const HWND windowHandle) {
    NOTIFYICONDATA nid = {
      .cbSize = sizeof(nid),
      .hWnd = windowHandle,
      .uID = notificationIconUid,
      .uFlags = NIF_ICON | NIF_TIP | NIF_MESSAGE | NIF_SHOWTIP,
      .uCallbackMessage = notificationCallbackMessage,
    };
    if (0 == LoadString(hInstance, IDS_TOOLTIP, nid.szTip, ARRAYSIZE(nid.szTip))) {
        ShowError(L"Failed to load system tray icon tooltip:", GetLastErrorAsWString());
        return false;
    }
    if (FAILED(LoadIconMetric(hInstance, MAKEINTRESOURCE(IDI_NOTIFICATIONICON), LIM_SMALL, &nid.hIcon))) {
        ShowError(L"Failed to load system tray icon:", GetLastErrorAsWString());
        return false;
    }
    if (!Shell_NotifyIcon(NIM_ADD, &nid)) {
        ShowError(L"Failed to show system tray icon:", GetLastErrorAsWString());
        return false;
    }

    notificationShown = true;
    nid.uVersion = NOTIFYICON_VERSION_4;
    Shell_NotifyIcon(NIM_SETVERSION, &nid);
    return true;
}

void removeNotificationIcon(HWND windowHandle) {
    if (notificationShown) {
        NOTIFYICONDATA nid = {
            .cbSize = sizeof(nid),
            .hWnd = windowHandle,
            .uID = notificationIconUid,
          };
        Shell_NotifyIcon(NIM_DELETE, &nid);
    }
    notificationShown = false;
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
            ouinet_client_stop();
            break;
        default:
            return DefWindowProc(hWnd, message, wParam, lParam);
        }
    }
    break;
    case exitOuinetMessage:
        ouinet_client_stop();
        break;
    case exitRequestMessage:
        DestroyWindow(hWnd);
        break;
    case WM_DESTROY:
        removeNotificationIcon(hWnd);
        PostQuitMessage(0);
        break;
    case WM_CREATE:
        if (!createNotificationIcon(hWnd)) {
            ouinet_client_stop();
            return 1;
        }
    [[fallthrough]];
    default:
        return DefWindowProc(hWnd, message, wParam, lParam);
    }
    return 0;
}
