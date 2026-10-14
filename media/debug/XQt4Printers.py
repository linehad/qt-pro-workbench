"""Register standalone Qt 4 printers for GDB/MI (no Qt Creator dependency)."""
import re
import gdb
from XQt4Values import TXQtStringPrinter, create_variant_printer
from XQt4Containers import TXQtSequencePrinter, TXQtMapPrinter

_TYPE_PATTERN = re.compile(r"^(?:[^<]+::)?(QStringRef|QStringList|QString|QByteArray|QChar|QVariant|QList|QQueue|QVector|QStack|QMap|QMultiMap|QHash|QMultiHash)(?:<|$)")


class TXQtUnavailablePrinter:
    def __init__(self, message):
        self._message = message

    def to_string(self):
        return "<unavailable Qt value: %s>" % self._message


def lookup_printer(value):
    value_type = value.type.strip_typedefs()
    if value_type.code == gdb.TYPE_CODE_REF:
        value = value.cast(value_type.target())
        value_type = value.type.strip_typedefs()
    if value_type.code != gdb.TYPE_CODE_STRUCT:
        return None
    name = str(value_type.unqualified())
    match = _TYPE_PATTERN.match(name)
    if not match:
        return None
    kind = match.group(1)
    try:
        if kind in ("QString", "QStringRef", "QByteArray", "QChar"):
            return TXQtStringPrinter(value, kind)
        if kind == "QVariant":
            return create_variant_printer(value)
        if kind in ("QList", "QStringList", "QQueue", "QVector", "QStack"):
            return TXQtSequencePrinter(value, kind)
        return TXQtMapPrinter(value, kind)
    except (RuntimeError, ValueError) as error:
        return TXQtUnavailablePrinter(str(error))


lookup_printer._qt_pro_workbench = True


def register_printers():
    # Reloading setup commands must not install a second copy of the printers.
    gdb.pretty_printers[:] = [printer for printer in gdb.pretty_printers if not getattr(printer, "_qt_pro_workbench", False)]
    gdb.pretty_printers.insert(0, lookup_printer)
