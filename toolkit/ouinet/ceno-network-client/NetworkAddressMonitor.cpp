#include <atomic>
#include <chrono>

#include <winsock2.h>
#include <windows.h>
#include <ws2ipdef.h>
#include <iphlpapi.h>

#include "NetworkAddressMonitor.h"

static HANDLE notify_handle = nullptr;

std::atomic<std::chrono::time_point<std::chrono::steady_clock>> network_address_changed_at;
static_assert(network_address_changed_at.is_always_lock_free);

static void CALLBACK ipChangeCallback(PVOID, PMIB_UNICASTIPADDRESS_ROW, MIB_NOTIFICATION_TYPE) {
    network_address_changed_at = std::chrono::steady_clock::now();
}

void startNetworkAddressMonitor() {
    network_address_changed_at = std::chrono::steady_clock::now();
    NotifyUnicastIpAddressChange(AF_UNSPEC, ipChangeCallback, nullptr, FALSE, &notify_handle);
}

void stopNetworkAddressMonitor() {
    if (notify_handle) {
        CancelMibChangeNotify2(notify_handle);
        notify_handle = nullptr;
    }
}
