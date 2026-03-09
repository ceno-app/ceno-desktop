#include "nsCOMPtr.h"
#include "nsIThread.h"           // Fixed: incomplete type
#include "nsIThreadManager.h"
#include "nsThreadUtils.h"       // NS_NewNamedThread, NS_DispatchToMainThread
#include "nsServiceManagerUtils.h" // do_GetService
#include "nsLiteralString.h"     // NS_LITERAL_CSTRING, _ns

#include "nsCOMPtr.h"           // nsCOMPtr, do_GetService
#include "nsIObserver.h"        // nsIObserver interface
#include "nsIThreadManager.h"   // nsIThreadManager
#include "nsThreadUtils.h"      // NS_NewRunnableFunction, NS_DispatchToMainThread
#include "nsComponentManagerUtils.h" // do_GetService (alternative: nsServiceManagerUtils.h)
#include "nsLiteralString.h"    // NS_LITERAL_CSTRING, _ns literals
#include <windows.h>

#include "OuinetNativeHelpers.h"

namespace mozilla {

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
OuinetNativeHelpers::EndProcess(const int32_t pid) {
    g_networkClientWindowHandle = nullptr;
    EnumWindows(EnumWindowsCallback, pid);
    if (nullptr == g_networkClientWindowHandle) {
        // return NS_ERROR_INVALID_ARG;
        return NS_OK;
    }

    ::PostMessageW(g_networkClientWindowHandle, WM_CLOSE, 0, 0);
    return NS_OK;
}

NS_IMETHODIMP
OuinetNativeHelpers::MonitorProcess(const int32_t pid, nsIObserver *callback) {
    struct HandleGuard {
        HANDLE h;
        explicit HandleGuard(HANDLE handle) : h(handle) {}
        ~HandleGuard() { if (h) ::CloseHandle(h); }
        void close() {
            if (h) {
                ::CloseHandle(h);
                h = nullptr;
            }
        }
        // Prevent copying (which would double-close)
        HandleGuard(const HandleGuard&) = delete;
        HandleGuard(HandleGuard&& other) : h(other.h) { other.h = nullptr; }
    };

    HandleGuard hProcess(::OpenProcess(SYNCHRONIZE | PROCESS_QUERY_LIMITED_INFORMATION, 0, pid));
    if (NULL == hProcess.h) {
        return NS_ERROR_INVALID_ARG;
    }

    // Hold a reference to the observer - JS won't keep it alive for us asynchronously
    nsCOMPtr<nsIObserver> observer(callback);
    
    // Get main thread to dispatch callback later
    nsCOMPtr<nsIThreadManager> tm = do_GetService("@mozilla.org/thread-manager;1");
    nsCOMPtr<nsIThread> mainThread;
    tm->GetMainThread(getter_AddRefs(mainThread));

    nsCOMPtr<nsIThread> thread;
    nsresult rv = NS_NewNamedThread("ProcessWait", getter_AddRefs(thread));
    NS_ENSURE_SUCCESS(rv, rv);
    
    thread->Dispatch(NS_NewRunnableFunction("ProcessWait", [mainThread, hProcess = std::move(hProcess), observer = std::move(observer)]() mutable {
        DWORD result = ::WaitForSingleObject(hProcess.h, INFINITE);
        DWORD exitCode = 1;
        BOOL exitCodeGetterStatus = 0;
        if (result == WAIT_OBJECT_0) {
            exitCodeGetterStatus = ::GetExitCodeProcess(hProcess.h, &exitCode);
        }
        hProcess.close();

        if (exitCodeGetterStatus) {
            mainThread->Dispatch(NS_NewRunnableFunction("ProcessExit", [observer = std::move(observer), exitCode]() {
                nsAutoString exitCodeStr;
                exitCodeStr.AppendInt(static_cast<int32_t>(exitCode));
                observer->Observe(nullptr, "ouinet-process-exited", exitCodeStr.get());
            }), NS_DISPATCH_NORMAL);
        }

        nsCOMPtr<nsIThread> currentThread;
        NS_GetCurrentThread(getter_AddRefs(currentThread));
        currentThread->Shutdown();
    }), NS_DISPATCH_NORMAL);

    return NS_OK;
}

}
