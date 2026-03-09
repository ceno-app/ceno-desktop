#pragma once

#include <atomic>

#include <windows.h>

#include "ArgumentsConverter.h"

extern std::atomic<HWND> windowHandleForCommunicatingFromOtherThreads;
extern std::atomic_int g_exitCode;
extern std::atomic_flag g_ouinetIsStuckOnExit_ForceExitInMain;

constexpr UINT ouinetStateChange = WM_APP + 3;

HWND createGuiWindow(HINSTANCE hInstance, ArgvConverter *args);
