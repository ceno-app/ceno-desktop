#pragma once

#include <string>
#include <string_view>

std::wstring GetLastErrorAsWString();
std::string GetLastErrorAsAString();

void ShowError(const std::wstring_view err_prefix, const std::wstring_view err_msg);
void ShowErrorA(const std::string_view err_prefix, const std::string_view err_msg);
