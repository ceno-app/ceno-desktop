#pragma once

#include <chrono>

void startStatePoller(WPARAM connectionId, std::chrono::time_point<std::chrono::steady_clock> ouinetStartedAt);
void stopStatePoller();

int unpackOuinetState(LPARAM lParam);
bool unpackInternetState(LPARAM lParam);
