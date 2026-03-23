#include "OuinetNativeHelpers.h"

namespace mozilla {

// This implements QueryInterface, AddRef, Release for all listed interfaces
NS_IMPL_ISUPPORTS(OuinetNativeHelpers, nsIOuinetNativeHelpers, nsIObserver)

OuinetNativeHelpers::OuinetNativeHelpers() {
    if (nsCOMPtr<nsIObserverService> obs = do_GetService("@mozilla.org/observer-service;1")) {
        if (NS_SUCCEEDED(obs->AddObserver(this, "quit-application-granted", false))) {
            isRegistered = true;

            hShutdownEvent = CreateEventW(nullptr, TRUE, FALSE, nullptr);
            if (!hShutdownEvent) {
                hShutdownEvent = nullptr;

                obs->RemoveObserver(this, "quit-application-granted");
                isRegistered = false;
            }
        }
    }
}

OuinetNativeHelpers::~OuinetNativeHelpers() {
    Shutdown();
}

void OuinetNativeHelpers::Shutdown() {
    if (hShutdownEvent != nullptr) {
        SetEvent(hShutdownEvent);
    }
    if (monitorThread) {
        monitorThread->Shutdown();
    }
    if (firewallMonitorThread) {
        firewallMonitorThread->Shutdown();
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
    firewallMonitorThread = nullptr;
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

}
