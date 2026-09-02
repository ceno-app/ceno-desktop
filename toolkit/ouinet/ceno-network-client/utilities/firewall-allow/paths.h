#pragma once

#include <optional>
#include <string>

std::wstring normalizePath(const wchar_t *raw);
std::optional<std::wstring> getMyPath();
std::wstring getNetworkClientPath(const wchar_t *myPath);
