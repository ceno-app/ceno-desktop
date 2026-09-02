#include "../OuinetNativeHelpers.h"
#include "nsString.h"

// #include <chrono>

namespace mozilla {

NS_IMETHODIMP
OuinetNativeHelpers::GetTimezone(nsAString& timezone) {
  const time_t now = time(nullptr);
  struct tm localtm {};
  if (!localtime_r(&now, &localtm)) {
    return NS_ERROR_FAILURE;
  }

  // Seconds east of UTC. Positive = ahead of UTC (east), negative = behind (west).
  const long offsetSec = static_cast<long>(localtm.tm_gmtoff);
  const bool negative = offsetSec < 0;
  const unsigned long absOffsetSec = negative
      ? -static_cast<unsigned long>(offsetSec)
      :  static_cast<unsigned long>(offsetSec);

  const unsigned long absMin = absOffsetSec / 60;
  const long hours   = static_cast<long>(absMin / 60);
  const long minutes = static_cast<long>(absMin % 60);

  nsAutoString tz;
  tz.AppendPrintf("UTC%s%02ld:%02ld", negative ? "-" : "+", hours, minutes);
  timezone = tz;
  return NS_OK;
}

} // namespace: mozilla
