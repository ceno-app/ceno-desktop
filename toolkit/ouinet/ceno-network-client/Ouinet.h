#pragma once

#include <filesystem>

void ouinet_client_run(const std::filesystem::path &ouinet_client_path, const wchar_t* arguments, void (*on_ouinet_exit)(int exit_code));
void ouinet_client_stop();
