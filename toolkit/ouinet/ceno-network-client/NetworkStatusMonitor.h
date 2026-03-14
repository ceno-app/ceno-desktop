#pragma once

#include <atomic>

extern std::atomic_bool network_is_online;

bool startNetworkStatusMonitor();
void stopNetworkStatusMonitor();
