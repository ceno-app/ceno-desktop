cmake_minimum_required(VERSION 4.0)
project(ceno-network-client)

set(CMAKE_CXX_STANDARD 20)

add_library(ouinetclient SHARED IMPORTED)
set_property(TARGET ouinetclient PROPERTY
    IMPORTED_LOCATION "${CMAKE_SOURCE_DIR}/Ouinet/ouinetclient.dll"
)
set_property(TARGET ouinetclient PROPERTY
    IMPORTED_IMPLIB "${CMAKE_SOURCE_DIR}/Ouinet/ouinetclient.lib"
)
set_property(TARGET ouinetclient PROPERTY
    INTERFACE_INCLUDE_DIRECTORIES "${CMAKE_SOURCE_DIR}/Ouinet"
)

add_executable(ceno-network-client WIN32 main.cpp app.rc)
target_link_options(ceno-network-client PRIVATE -municode)
target_compile_definitions(ceno-network-client PUBLIC UNICODE _UNICODE)
target_link_libraries(ceno-network-client ouinetclient Comctl32)
