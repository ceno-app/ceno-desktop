#include "../OuinetNativeHelpers.h"
#include "nsString.h"

namespace mozilla {

NS_IMETHODIMP
OuinetNativeHelpers::GetRegion(nsAString& region) {
  region = nsAutoString();
  return NS_OK;
}

} // namespace: mozilla
