#pragma once

#include <atomic>
#include <chrono>

extern std::atomic<std::chrono::time_point<std::chrono::steady_clock>> network_address_changed_at;

void startNetworkAddressMonitor();
void stopNetworkAddressMonitor();
