#include "nsString.h"

#include <format>
#include <timezoneapi.h>
#include <winnls.h>

#include "MetricsGeoTimezone.h"

namespace mozilla {

// Use the macro to inject all of the definitions for nsISupports.
NS_IMPL_ISUPPORTS(MetricsGeoTimezone, nsIMetricsGeoTimezone)

NS_IMETHODIMP
MetricsGeoTimezone::GetRegion(nsAString& region) {
  wchar_t region_c[4] {};
  GetUserDefaultGeoName(region_c, 4);
  region = region_c;
  return NS_OK;
}

NS_IMETHODIMP
MetricsGeoTimezone::GetTimezone(nsAString& timezone) {
  TIME_ZONE_INFORMATION timeZoneInformation {};
  const auto isItDstNow = GetTimeZoneInformation(&timeZoneInformation);

  long calculatedBias = timeZoneInformation.Bias;
  if (isItDstNow == TIME_ZONE_ID_DAYLIGHT) {
    calculatedBias += timeZoneInformation.DaylightBias;
  } else {
    calculatedBias += timeZoneInformation.StandardBias;
  }

  // UTC = local time + bias
  calculatedBias = 0 - calculatedBias;

  long biasHours = calculatedBias / 60;
  long biasMinutes = calculatedBias % 60;
  timezone = std::format(L"UTC{0:+03}:{1:02}", biasHours, biasMinutes).c_str();

  return NS_OK;
}

} // namespace: mozilla
