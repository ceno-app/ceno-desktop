#include "OuinetNativeHelpers.h"

#include "nsIObserverService.h"
#include "nsServiceManagerUtils.h"

namespace mozilla {

// This implements QueryInterface, AddRef, Release for all listed interfaces
NS_IMPL_ISUPPORTS(OuinetNativeHelpers, nsIOuinetNativeHelpers, nsIObserver)

OuinetNativeHelpers::OuinetNativeHelpers() {
    if (nsCOMPtr<nsIObserverService> obs = do_GetService("@mozilla.org/observer-service;1")) {
      isRegistered = NS_SUCCEEDED(obs->AddObserver(this, "quit-application-granted", false));
#if defined(XP_WIN)
      shutdownEvent = CreateEventW(nullptr, TRUE, FALSE, nullptr);
      portUpdateEvent = CreateEventW(nullptr, FALSE, FALSE, nullptr);
      if (!isRegistered || !shutdownEvent || !portUpdateEvent) {
        if (shutdownEvent) ::CloseHandle(shutdownEvent);
        if (portUpdateEvent) ::CloseHandle(portUpdateEvent);
        if (isRegistered) obs->RemoveObserver(this, "quit-application-granted");
        portUpdateEvent = nullptr;
        shutdownEvent = nullptr;
        isRegistered = false;
      }
#elif defined(XP_LINUX)
      if (pipe(shutdownEvent) != 0) shutdownEvent[0] = -1;
      if (pipe(portUpdateEvent) != 0) portUpdateEvent[0] = -1;
      if (!isRegistered || -1 == shutdownEvent[0] || -1 == portUpdateEvent[0]) {
          if (-1 != shutdownEvent[0]) {
              close(shutdownEvent[0]);
              close(shutdownEvent[1]);
          }
          if (-1 != portUpdateEvent[0]) {
              close(portUpdateEvent[0]);
              close(portUpdateEvent[1]);
          }
          shutdownEvent[0] = -1;
          shutdownEvent[1] = -1;
          portUpdateEvent[0] = -1;
          portUpdateEvent[1] = -1;
          if (isRegistered) {
              obs->RemoveObserver(this, "quit-application-granted");
              isRegistered = false;
          }
      }
#endif
    }
}

OuinetNativeHelpers::~OuinetNativeHelpers() {
    Shutdown();
}

void OuinetNativeHelpers::Shutdown() {
#if defined(XP_WIN)
    if (shutdownEvent != nullptr) {
        SetEvent(shutdownEvent);
    }
#elif defined(XP_LINUX)
    if (-1 != shutdownEvent[1]) {
        const char buffer = 0;
        (void) write(shutdownEvent[1], &buffer, 1);
    }
#endif
    if (clientMonitorThread) {
        clientMonitorThread->Shutdown();
    }
    if (networkStatusMonitorThread) {
        networkStatusMonitorThread->Shutdown();
    }
    if (firewallMonitorThread) {
        firewallMonitorThread->Shutdown();
    }
#if defined(XP_WIN)
    if (portUpdateEvent) {
        ::CloseHandle(portUpdateEvent);
    }
    if (shutdownEvent) {
        ::CloseHandle(shutdownEvent);
    }
    shutdownEvent = nullptr;
    portUpdateEvent = nullptr;
#elif defined(XP_LINUX)
    if (-1 != shutdownEvent[0]) {
        close(shutdownEvent[0]);
        close(shutdownEvent[1]);
    }
    if (-1 != portUpdateEvent[0]) {
        close(portUpdateEvent[0]);
        close(portUpdateEvent[1]);
    }
    shutdownEvent[0] = -1;
    shutdownEvent[1] = -1;
    portUpdateEvent[0] = -1;
    portUpdateEvent[1] = -1;
#endif
    if (isRegistered) {
        if (nsCOMPtr<nsIObserverService> obs = do_GetService("@mozilla.org/observer-service;1")) {
            obs->RemoveObserver(this, "quit-application-granted");
        }
    }
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
