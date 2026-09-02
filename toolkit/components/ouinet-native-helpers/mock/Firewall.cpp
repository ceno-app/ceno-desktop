#include "OuinetNativeHelpers.h"
#include "../Firewall.h"

namespace mozilla {

NS_IMETHODIMP
OuinetNativeHelpers::ModifyFirewallMonitorPort(const int32_t port) {
  udpPort = port;
  return NS_OK;
}

NS_IMETHODIMP
OuinetNativeHelpers::MonitorFirewall(const nsAString &executable, nsIObserver *callback, const int32_t port) {
  if (!callback) return NS_ERROR_INVALID_POINTER;
  callback->Observe(nullptr, "firewall-modified", InboundStatusStr(InboundStatus::FirewallDisabled) );
  return NS_OK;
}

}
