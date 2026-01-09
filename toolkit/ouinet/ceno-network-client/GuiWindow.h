#pragma once

#include <filesystem>

#include <windows.h>

HWND createGuiWindow(HINSTANCE hInstance, const std::filesystem::path &cenoExecutablePath);
void requestWindowClose();

bool createNotificationIcon(HWND windowHandle);
void removeNotificationIcon(HWND windowHandle);
