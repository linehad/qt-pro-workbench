#include <QtCore/QCoreApplication>
#include <QtCore/QDir>
#include <QtCore/QFile>
#include <QtCore/QTextStream>

int main(int argc, char* argv[])
{
    QCoreApplication application(argc, argv);
    QFile file("run-result.txt");
    if (!file.open(QIODevice::WriteOnly | QIODevice::Text))
    {
        return 2;
    }
    QTextStream stream(&file);
    stream << QDir::currentPath() << '\n' << (argc - 1) << '\n';
    for (int index = 1; index < argc; ++index)
    {
        stream << argv[index] << '\n';
    }
    return 0;
}
