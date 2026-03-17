#include "nsCOMPtr.h"

#include "nsIThreadManager.h"
#include "nsThreadUtils.h"       // NS_NewNamedThread, NS_DispatchToMainThread
#include "nsServiceManagerUtils.h" // do_GetService
#include "nsLiteralString.h"     // NS_LITERAL_CSTRING, _ns

#include "nsCOMPtr.h"           // nsCOMPtr, do_GetService
#include "nsIObserver.h"        // nsIObserver interface
#include "nsIObserverService.h"        // nsIObserver interface
#include "nsIThreadManager.h"   // nsIThreadManager
#include "nsThreadUtils.h"      // NS_NewRunnableFunction, NS_DispatchToMainThread
#include "nsComponentManagerUtils.h" // do_GetService (alternative: nsServiceManagerUtils.h)
#include "nsLiteralString.h"    // NS_LITERAL_CSTRING, _ns literals
#include "mozilla/ScopeExit.h"
#include <windows.h>

#include "OuinetNativeHelpers.h"

namespace mozilla {

// This implements QueryInterface, AddRef, Release for all listed interfaces
NS_IMPL_ISUPPORTS(OuinetNativeHelpers, nsIOuinetNativeHelpers, nsIObserver)

// EnumWindowsCallback Source:
// https://stackoverflow.com/questions/11711417/get-hwnd-by-process-id-c/20730976#20730976
// Posted by Andre Kirpitch
// Retrieved 2026-01-05, License - CC BY-SA 3.0
static HWND g_networkClientWindowHandle = nullptr;
BOOL CALLBACK EnumWindowsCallback(HWND hwnd, const LPARAM processId) {
    DWORD windowProcessId;
    ::GetWindowThreadProcessId(hwnd, &windowProcessId);

    if (processId == windowProcessId) {
        g_networkClientWindowHandle = hwnd;
        return FALSE;
    }
    return TRUE;
}

NS_IMETHODIMP
OuinetNativeHelpers::CheckIfWindowExists(const int32_t pid, bool *aResult) {
    NS_ENSURE_ARG_POINTER(aResult);

    g_networkClientWindowHandle = nullptr;
    EnumWindows(EnumWindowsCallback, pid);

    *aResult = nullptr == g_networkClientWindowHandle;
}

NS_IMETHODIMP
OuinetNativeHelpers::EndProcess(const int32_t pid) {
    g_networkClientWindowHandle = nullptr;
    EnumWindows(EnumWindowsCallback, pid);

    if (nullptr == g_networkClientWindowHandle) {
        return NS_ERROR_INVALID_ARG;
    }

    if (0 == ::PostMessageW(g_networkClientWindowHandle, WM_CLOSE, 0, 0)) {
        return NS_ERROR_INVALID_ARG;
    }

    return NS_OK;
}

NS_IMETHODIMP
OuinetNativeHelpers::EndOrKillProcess(const int32_t pid) {
    HANDLE hProcess = ::OpenProcess(PROCESS_TERMINATE, 0, pid);
    auto handleGuard = MakeScopeExit([&] { if (NULL != hProcess) { CloseHandle(hProcess);} });

    // Process creation and window handle creation is not atomic
    // Send WM_CLOSE if window exists
    if (NS_OK == EndProcess(pid)) {
        return NS_OK;
    }

    // Terminate process if window don't exist.
    // Downside is that the window may have been created right after
    // the failed call to EndProcess() and before ::TerminateProcess()
    if (NULL == hProcess || 0 == ::TerminateProcess(hProcess, 1)) {
        return NS_ERROR_INVALID_ARG;
    }

    return NS_OK;
}

void OuinetNativeHelpers::Shutdown() {
    if (hShutdownEvent != nullptr) {
        SetEvent(hShutdownEvent);
    }
    if (monitorThread) {
        monitorThread->Shutdown();
    }
    if (hShutdownEvent) {
        ::CloseHandle(hShutdownEvent);
    }
    if (isRegistered) {
        if (nsCOMPtr<nsIObserverService> obs = do_GetService("@mozilla.org/observer-service;1")) {
            obs->RemoveObserver(this, "quit-application-granted");
        }
    }
    hShutdownEvent = nullptr;
    monitorThread = nullptr;
    isRegistered = false;
}

NS_IMETHODIMP
OuinetNativeHelpers::Observe(nsISupports *subject, const char *topic, const char16_t *data) {
    if (strcmp(topic, "quit-application-granted") == 0) {
        Shutdown();
    }
    return NS_OK;
}

OuinetNativeHelpers::OuinetNativeHelpers() {
    if (nsCOMPtr<nsIObserverService> obs = do_GetService("@mozilla.org/observer-service;1")) {
        if (NS_SUCCEEDED(obs->AddObserver(this, "quit-application-granted", false))) {
            isRegistered = true;
        }
    }
}
OuinetNativeHelpers::~OuinetNativeHelpers() {
    Shutdown();
}

struct CallbackGuard {
    nsIObserver* obs;
    explicit CallbackGuard(nsIObserver* o) : obs(o) {}
    ~CallbackGuard() { if (obs) NS_RELEASE(obs); }

    // Disable copy to prevent double-release
    CallbackGuard(const CallbackGuard&) = delete;
    CallbackGuard& operator=(const CallbackGuard&) = delete;

    // Enable move to transfer ownership
    CallbackGuard(CallbackGuard&& other) noexcept : obs(other.obs) {
        other.obs = nullptr;
    }
    CallbackGuard& operator=(CallbackGuard&& other) noexcept {
        if (this != &other) {
            if (obs) NS_RELEASE(obs);
            obs = other.obs;
            other.obs = nullptr;
        }
        return *this;
    }
};

NS_IMETHODIMP
OuinetNativeHelpers::MonitorProcess(const int32_t pid, nsIObserver *callback) {
    if (!hShutdownEvent) {
        hShutdownEvent = CreateEventW(nullptr, TRUE, FALSE, nullptr);
        if (!hShutdownEvent) {
            return NS_ERROR_OUT_OF_MEMORY;
        }
    }
    if (!monitorThread) {
        nsresult rv = NS_NewNamedThread("MonitorProcess", getter_AddRefs(monitorThread));
        NS_ENSURE_SUCCESS(rv, rv);
    }

    HANDLE hProcess = ::OpenProcess(SYNCHRONIZE | PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
    if (NULL == hProcess) {
        return NS_ERROR_INVALID_ARG;
    }
    NS_ADDREF(callback);

    CallbackGuard callbackGuard (callback);
    auto handleGuard = MakeScopeExit([&] { CloseHandle(hProcess); });

    HANDLE hShutdown = hShutdownEvent;

    nsresult rv = monitorThread->Dispatch(NS_NewRunnableFunction("ProcessWait", [hProcess, hShutdown, callbackGuard = std::move(callbackGuard)]() mutable {
        // observer pointer leaks if NS_DispatchToMainThread fails (returns NS_ERROR_FAILURE).
        // This is because it can only be released on main thread, not on this current worker thread.
        // If NS_DispatchToMainThread fails, it means there's no way other reasonable way to release it.
        nsIObserver* observer = callbackGuard.obs;
        callbackGuard.obs = nullptr;  // Prevent guard from releasing

        HANDLE handles[2] = { hProcess, hShutdown };
        DWORD result = ::WaitForMultipleObjects(2, handles, FALSE, INFINITE);

        DWORD exitCode = 0;
        ::GetExitCodeProcess(hProcess, &exitCode);
        ::CloseHandle(hProcess);

        NS_DispatchToMainThread(NS_NewRunnableFunction("ProcessExit", [observer, result, exitCode]() mutable {
            if (result == WAIT_OBJECT_0) {
                nsAutoString exitCodeStr;
                exitCodeStr.AppendInt(static_cast<int32_t>(exitCode));
                observer->Observe(nullptr, "process-exited", exitCodeStr.get());
            }
            NS_RELEASE(observer);
        }), NS_DISPATCH_NORMAL);
    }), NS_DISPATCH_NORMAL);

    NS_ENSURE_SUCCESS(rv, rv);

    // Ownership transferred successfully
    handleGuard.release();

    return NS_OK;
}

}
