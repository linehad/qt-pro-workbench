"""Qt 4 value printers using the Python 2.7 API shipped with GDB 7.2."""
import gdb
import json
import sys

MAX_VALUE_SIZE = 1000000
try:
    _unicode_character = unichr
except NameError:
    _unicode_character = chr


def checked_size(value):
    size = int(value)
    if size < 0 or size > MAX_VALUE_SIZE:
        raise ValueError("invalid Qt size: %d" % size)
    return size


def type_prefix(value):
    name = str(value.type.strip_typedefs().unqualified())
    head = name.split("<", 1)[0]
    return head.rsplit("::", 1)[0] + "::" if "::" in head else ""


def pointer_address(value):
    return int(value.cast(gdb.lookup_type("unsigned long long")))


class TXQtStringPrinter:
    def __init__(self, value, kind):
        self._value = value
        self._kind = kind

    def to_string(self):
        text = json.dumps(self._text_value(), ensure_ascii=False)
        # GDB 7.2 otherwise encodes Python unicode with the Windows ANSI code page.
        return text.encode("utf-8") if sys.version_info[0] < 3 else text

    def display_hint(self):
        # GDB 7.2 escapes non-BMP characters even with UTF-8; format quotes ourselves.
        return None

    def _text_value(self):
        if self._kind == "QChar":
            return _unicode_character(int(self._value["ucs"]))
        if self._kind == "QStringRef":
            count = checked_size(self._value["m_size"])
            position = checked_size(self._value["m_position"])
            if not count:
                return u""
            owner = self._value["m_string"].dereference()["d"].dereference()
            if position + count > checked_size(owner["size"]):
                raise ValueError("QStringRef extends past its string")
            data = owner["data"] + position
        else:
            owner = self._value["d"].dereference()
            count = checked_size(owner["size"])
            if not count:
                return u""
            data = owner["data"]
        byte_pointer = data.cast(gdb.lookup_type("char").pointer())
        if self._kind == "QByteArray":
            return byte_pointer.string("ISO-8859-1", "strict", count)
        return byte_pointer.string("UTF-16LE", "strict", count * 2)

class TXQtVariantPrinter:
    _PRIMITIVES = {1: "b", 2: "i", 3: "u", 4: "ll", 5: "ull", 6: "d"}
    _TYPES = {7: "QChar", 8: "QMap<QString, QVariant>", 9: "QList<QVariant>", 10: "QString", 11: "QStringList", 12: "QByteArray"}

    def __init__(self, value):
        self._value = value
        self._private = value["d"]
        self._type = int(self._private["type"])

    def to_string(self):
        if not self._type:
            return "QVariant(invalid)"
        inner = self._inner_value()
        if inner is None:
            return "QVariant(type = %d)" % self._type
        visualizer = gdb.default_visualizer(inner)
        return visualizer.to_string() if visualizer is not None else str(inner)

    def _inner_value(self):
        data = self._private["data"]
        if self._type in self._PRIMITIVES:
            return data[self._PRIMITIVES[self._type]]
        name = self._TYPES.get(self._type)
        if not name:
            return None
        prefix = type_prefix(self._value)
        if prefix:
            name = name.replace("Q", prefix + "Q")
        value_type = gdb.lookup_type(name)
        pointer = data.address
        if bool(self._private["is_shared"]):
            pointer = data["shared"].dereference()["ptr"]
        return pointer.cast(value_type.pointer()).dereference()


class TXQtVariantContainerPrinter(TXQtVariantPrinter):
    def __init__(self, value, visualizer):
        TXQtVariantPrinter.__init__(self, value)
        self._visualizer = visualizer

    def display_hint(self):
        return self._visualizer.display_hint()

    def children(self):
        return self._visualizer.children()


class TXQtVariantUnknownPrinter(TXQtVariantPrinter):
    def children(self):
        yield ("raw", self._private)


def create_variant_printer(value):
    printer = TXQtVariantPrinter(value)
    inner = printer._inner_value()
    if inner is None:
        return TXQtVariantUnknownPrinter(value) if printer._type else printer
    visualizer = gdb.default_visualizer(inner)
    # GDB 7.2/MI replaces any scalar with children() by {...}, ignoring to_string().
    if visualizer is not None and hasattr(visualizer, "children"):
        return TXQtVariantContainerPrinter(value, visualizer)
    return printer
