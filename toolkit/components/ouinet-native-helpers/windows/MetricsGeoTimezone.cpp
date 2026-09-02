#include "nsString.h"

#include <windows.h>
#include <timezoneapi.h>

#include "../OuinetNativeHelpers.h"

namespace mozilla {

NS_IMETHODIMP
OuinetNativeHelpers::GetRegion(nsAString& region) {
  wchar_t region_c[4] {};
  GetUserDefaultGeoName(region_c, 4);
  region = region_c;
  return NS_OK;
}

NS_IMETHODIMP
OuinetNativeHelpers::GetTimezone(nsAString& timezone) {
  TIME_ZONE_INFORMATION timeZoneInformation {};
  const auto isItDstNow = GetTimeZoneInformation(&timeZoneInformation);

  long calculatedBias = timeZoneInformation.Bias;
  if (isItDstNow == TIME_ZONE_ID_DAYLIGHT) {
    calculatedBias += timeZoneInformation.DaylightBias;
  } else {
    calculatedBias += timeZoneInformation.StandardBias;
  }
  calculatedBias = -calculatedBias;  // convert to UTC offset

  const bool negative = calculatedBias < 0;
  const unsigned long absBias = negative
      ? -static_cast<unsigned long>(calculatedBias)
      :  static_cast<unsigned long>(calculatedBias);

  const long hours   = static_cast<long>(absBias / 60);
  const long minutes = static_cast<long>(absBias % 60);

  nsAutoString tz;
  tz.AppendPrintf("UTC%s%02ld:%02ld", negative ? "-" : "+", hours, minutes);
  timezone = tz;
  return NS_OK;
}

} // namespace: mozilla
