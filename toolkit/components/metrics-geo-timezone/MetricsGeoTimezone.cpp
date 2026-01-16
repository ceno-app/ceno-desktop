#include "nsString.h"

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

  timezone = (isItDstNow == TIME_ZONE_ID_DAYLIGHT) ? timeZoneInformation.DaylightName : timeZoneInformation.StandardName;
  return NS_OK;
}

} // namespace: mozilla
