#include "nsIObserver.h"
#include "../OuinetNativeHelpers.h"

namespace mozilla {

NS_IMETHODIMP
OuinetNativeHelpers::MonitorNetworkStatus(nsIObserver *callback) {
    if (!callback) return NS_ERROR_INVALID_POINTER;
    callback->Observe(nullptr, "network-status-changed", u"Online");
    return NS_OK;
}

} // namespace mozilla
