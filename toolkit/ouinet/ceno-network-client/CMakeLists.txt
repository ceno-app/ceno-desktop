# Ceno Network Client has 2 build systems
# CMake and moz.build
# moz.build is used as part of Ceno Browser build process
# This CMakeLists.txt is here to allow building it separately,
# for testing and debugging purposes

cmake_minimum_required(VERSION 4.0)
project(ceno-network-client)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

set(CMAKE_VERBOSE_MAKEFILE=ON)
add_definitions(
    -DNTDDI_VERSION=0x0A000000
    -DWINVER=0x0A00
    -D_WIN32_WINNT=0x0A00
    -DWINAPI_FAMILY=WINAPI_FAMILY_DESKTOP_APP
    -DUNICODE
    -D_UNICODE
    -DWIN32=1
    -DWIN32_LEAN_AND_MEAN=1
    -D_WINDOWS=1
    -DWIN32_EXECUTABLE=1
)

add_executable(ceno-network-client WIN32
        app.rc
        ArgumentsConverter.cpp
        ArgumentsConverter.h
        ErrorUtils.cpp
        ErrorUtils.h
        GuiWindow.cpp
        GuiWindow.h
        Resource.h
        ceno-network-client.cpp
        ceno.ico
        cenogray.ico
        StatePoller.cpp
        StatePoller.h
        NetworkStatusMonitor.cpp
        NetworkStatusMonitor.h
        NetworkAddressMonitor.cpp
        NetworkAddressMonitor.h
)

target_link_libraries(ceno-network-client comctl32 iphlpapi
    ${CMAKE_CURRENT_LIST_DIR}/../../../obj-x86_64-w64-mingw32/dist/bin/Ouinet/libclient_lib.dll
)
target_include_directories(ceno-network-client PRIVATE
    ${CMAKE_CURRENT_LIST_DIR}/../../../obj-x86_64-w64-mingw32/dist/bin/Ouinet/)

# No exceptions to match compile options in moz.build,
# moz.build disabled exceptions by default
target_compile_options(ceno-network-client PUBLIC -municode -fno-exceptions)
target_link_options(ceno-network-client PUBLIC -municode)
