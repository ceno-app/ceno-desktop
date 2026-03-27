#include "OuinetNativeHelpers.h"

namespace mozilla {

// This implements QueryInterface, AddRef, Release for all listed interfaces
NS_IMPL_ISUPPORTS(OuinetNativeHelpers, nsIOuinetNativeHelpers, nsIObserver)

OuinetNativeHelpers::OuinetNativeHelpers() {
    if (nsCOMPtr<nsIObserverService> obs = do_GetService("@mozilla.org/observer-service;1")) {
        if (NS_SUCCEEDED(obs->AddObserver(this, "quit-application-granted", false))) {
            isRegistered = true;

            shutdownEvent = CreateEventW(nullptr, TRUE, FALSE, nullptr);
            if (!shutdownEvent) {
                obs->RemoveObserver(this, "quit-application-granted");
                isRegistered = false;
            }

            portUpdateEvent = CreateEventW(nullptr, FALSE, FALSE, nullptr);
            if (!portUpdateEvent) {
                ::CloseHandle(shutdownEvent);
                shutdownEvent = nullptr;

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
    if (shutdownEvent != nullptr) {
        SetEvent(shutdownEvent);
    }
    if (clientMonitorThread) {
        clientMonitorThread->Shutdown();
    }
    if (firewallMonitorThread) {
        firewallMonitorThread->Shutdown();
    }
    if (portUpdateEvent) {
        ::CloseHandle(portUpdateEvent);
    }
    if (shutdownEvent) {
        ::CloseHandle(shutdownEvent);
    }
    if (isRegistered) {
        if (nsCOMPtr<nsIObserverService> obs = do_GetService("@mozilla.org/observer-service;1")) {
            obs->RemoveObserver(this, "quit-application-granted");
        }
    }
    shutdownEvent = nullptr;
    portUpdateEvent = nullptr;
    firewallMonitorThread = nullptr;
    clientMonitorThread = nullptr;
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
