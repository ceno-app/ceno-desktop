#include <filesystem>

#include "nsServiceManagerUtils.h"
#include "nsCOMPtr.h"           // nsCOMPtr, do_GetService
#include "nsIObserver.h"        // nsIObserver interface
#include "nsIObserverService.h"        // nsIObserver interface
#include "nsIThreadManager.h"   // nsIThreadManager
#include "nsThreadUtils.h"      // NS_NewRunnableFunction, NS_DispatchToMainThread
#include "nsComponentManagerUtils.h" // do_GetService (alternative: nsServiceManagerUtils.h)
#include "nsLiteralString.h"    // NS_LITERAL_CSTRING, _ns literals
#include "mozilla/ScopeExit.h"
#include <windows.h>

#include "../OuinetNativeHelpers.h"

namespace mozilla {

struct EnumCtx {
    const DWORD processId;
    HWND hWndResult;
};

// EnumWindowsCallback Source:
// https://stackoverflow.com/questions/11711417/get-hwnd-by-process-id-c/20730976#20730976
// Posted by Andre Kirpitch
// Retrieved 2026-01-05, License - CC BY-SA 3.0
// EnumCtx modification added later
BOOL CALLBACK EnumWindowsCallback(HWND hwnd, const LPARAM processId) {
    auto *ctx = reinterpret_cast<EnumCtx*>(processId);
    DWORD windowProcessId;
    ::GetWindowThreadProcessId(hwnd, &windowProcessId);

    if (ctx->processId == windowProcessId) {
        ctx->hWndResult = hwnd;
        return FALSE;
    }
    return TRUE;
}

static bool CheckProcessImageName(HANDLE processHandle) {
    constexpr const wchar_t *expectedFilename = L"ceno-network-client.exe";
    std::wstring path(MAX_PATH, L'\0');
    DWORD size = MAX_PATH;
    if (!QueryFullProcessImageNameW(processHandle, 0, path.data(), &size)) {
        if (ERROR_INSUFFICIENT_BUFFER != GetLastError()) {
            return false;
        }
        constexpr DWORD NT_MAX_PATH = 32767;
        path.resize(NT_MAX_PATH);
        size = NT_MAX_PATH;
        if (!QueryFullProcessImageNameW(processHandle, 0, path.data(), &size)) {
            return false;
        }
    }
    path.resize(wcsnlen(path.c_str(), path.size()));
    return _wcsicmp(std::filesystem::path{path}.filename().c_str(), expectedFilename) == 0;
}

NS_IMETHODIMP
OuinetNativeHelpers::EndNetworkClientProcess(const int32_t pid) {
    HANDLE hProcess = ::OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_TERMINATE, 0, pid);
    if (NULL == hProcess) return NS_ERROR_INVALID_ARG;
    auto handleGuard = MakeScopeExit([&hProcess] { CloseHandle(hProcess); });

    if (!CheckProcessImageName(hProcess)) return NS_ERROR_INVALID_ARG;

    // Process creation and window handle creation is not atomic
    // Send WM_CLOSE if window exists
    EnumCtx ctx { static_cast<DWORD>(pid), nullptr };
    EnumWindows(EnumWindowsCallback, reinterpret_cast<LPARAM>(&ctx));
    if (nullptr != ctx.hWndResult) {
        if (::PostMessageW(ctx.hWndResult, WM_CLOSE, 0, 0)) {
            return NS_OK;
        }
    }

    // Terminate process if window don't exist.
    // Downside is that the window may have been created right after
    // the failed call to EndProcess() and before ::TerminateProcess()
    return ::TerminateProcess(hProcess, 1) ? NS_OK : NS_ERROR_INVALID_ARG;
}

NS_IMETHODIMP
OuinetNativeHelpers::MonitorNetworkClientProcess(const int32_t pid, nsIObserver *callback) {
    if (!callback) return NS_ERROR_INVALID_POINTER;
    if (!shutdownEvent) return NS_ERROR_NOT_INITIALIZED;
    if (!clientMonitorThread) {
        nsresult rv = NS_NewNamedThread("MonitorProcess", getter_AddRefs(clientMonitorThread));
        NS_ENSURE_SUCCESS(rv, rv);
    }

    HANDLE hProcess = ::OpenProcess(SYNCHRONIZE | PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
    if (NULL == hProcess) return NS_ERROR_INVALID_ARG;
    auto handleGuard = MakeScopeExit([&] { CloseHandle(hProcess); });
    if (!CheckProcessImageName(hProcess)) return NS_ERROR_INVALID_ARG;

    HANDLE hShutdown = shutdownEvent;

    nsMainThreadPtrHandle<nsIObserver> callbackHandle(new nsMainThreadPtrHolder<nsIObserver>("OuinetMonitorCallback", callback));

    nsresult rv = clientMonitorThread->Dispatch(NS_NewRunnableFunction("ProcessWait", [
        hProcess, hShutdown, callbackHandle
    ]() mutable {
        HANDLE handles[2] = { hProcess, hShutdown };
        if (WAIT_OBJECT_0 + 1 == ::WaitForMultipleObjects(2, handles, FALSE, INFINITE)) {
            ::CloseHandle(hProcess);
            return;
        }

        DWORD exitCode = 0;
        ::GetExitCodeProcess(hProcess, &exitCode);
        ::CloseHandle(hProcess);

        nsAutoString exitCodeStr;
        exitCodeStr.AppendInt(static_cast<int32_t>(exitCode));

        NS_DispatchToMainThread(NS_NewRunnableFunction("ProcessExit", [callbackHandle, exitCodeStr = std::move(exitCodeStr)]() mutable {
            callbackHandle->Observe(nullptr, "process-exited", exitCodeStr.get());
        }), NS_DISPATCH_NORMAL);
    }), NS_DISPATCH_NORMAL);

    NS_ENSURE_SUCCESS(rv, rv);

    // Ownership transferred successfully
    handleGuard.release();

    return NS_OK;
}

}
