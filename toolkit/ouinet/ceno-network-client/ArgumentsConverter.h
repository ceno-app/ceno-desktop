#pragma once

#include <filesystem>
#include <optional>
#include <string>
#include <vector>

struct ArgvConverter {
    int argc = 0;

    // First vector stores strings in narrow format
    // Second vector stores char * to those strings
    std::vector<std::string> storage;
    std::vector<const char*> argv;

    std::optional<std::filesystem::path> ceno_network_client_path;
    std::optional<std::filesystem::path> repo_path;

    explicit ArgvConverter(const wchar_t *wArgsStr);
};
