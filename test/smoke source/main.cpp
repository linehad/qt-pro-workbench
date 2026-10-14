#include <QtCore/QCoreApplication>
#include <cstdio>
int main(int argc, char **argv) { QCoreApplication app(argc, argv); std::printf("QtPro smoke %s\n", qVersion()); return 0; }
