"""Read Qt 4 containers without calling functions in the stopped application."""
import gdb
from XQt4Values import checked_size, type_prefix, pointer_address

_MOVABLE_TYPES = {"QString", "QByteArray", "QChar", "QDate", "QTime", "QList", "QVector", "QMap", "QHash", "QStringList", "QPoint", "QSize"}


def _lookup_struct_type(name):
    try:
        return gdb.lookup_type(name)
    except RuntimeError:
        # GDB 7.2's type lookup rejects some multiword template arguments.
        return gdb.parse_and_eval("(class '%s' *)0" % name).type.target()


def _mingw_value_alignment(value_type):
    canonical = value_type.strip_typedefs()
    if canonical.code == gdb.TYPE_CODE_STRUCT:
        name = str(canonical.unqualified()).rsplit("::", 1)[-1]
        if name not in ("QString", "QByteArray", "QChar", "QVariant"):
            raise ValueError("Qt map node debug type is missing")
    # QtSDK's 32-bit MinGW aligns double/long long to 8 bytes in structures.
    return min(canonical.sizeof, 8) if canonical.sizeof != 12 else 4


def _aligned_size(size, alignment):
    return (size + alignment - 1) // alignment * alignment


def _list_stores_pointer(value_type):
    value_type = value_type.strip_typedefs().unqualified()
    if value_type.sizeof > gdb.lookup_type("void").pointer().sizeof:
        return True
    if value_type.code != gdb.TYPE_CODE_STRUCT:
        return False
    try:
        return bool(gdb.parse_and_eval("QTypeInfo<%s>::isStatic" % value_type))
    except RuntimeError:
        # Qt's relocatable small values live directly in the list's pointer slot.
        name = str(value_type).split("<", 1)[0].rsplit("::", 1)[-1]
        return name not in _MOVABLE_TYPES


class TXQtSequencePrinter:
    def __init__(self, value, kind):
        self._value = value
        self._kind = kind
        self._data = value["d"].dereference()
        self._is_vector = kind in ("QVector", "QStack")
        self._begin = 0 if self._is_vector else int(self._data["begin"])
        end = int(self._data["size"]) if self._is_vector else int(self._data["end"])
        self._size = checked_size(end - self._begin)
        if self._begin < 0 or end > int(self._data["alloc"]):
            raise ValueError("invalid Qt sequence bounds")

    def to_string(self):
        return "size = %d" % self._size

    def display_hint(self):
        return "array"

    def children(self):
        if not self._size:
            return
        if self._is_vector:
            array = self._value["p"].dereference()["array"].address
            value_type = self._value.type.strip_typedefs().unqualified().template_argument(0)
            pointer = array.cast(value_type.pointer())
            for index in range(self._size):
                yield ("[%d]" % index, (pointer + index).dereference())
            return
        if self._kind == "QStringList":
            value_type = gdb.lookup_type(type_prefix(self._value) + "QString")
        else:
            value_type = self._value.type.strip_typedefs().unqualified().template_argument(0)
        slots = self._data["array"].address.cast(gdb.lookup_type("void").pointer().pointer()) + self._begin
        is_indirect = _list_stores_pointer(value_type)
        for index in range(self._size):
            slot = slots + index
            pointer = slot.dereference() if is_indirect else slot
            yield ("[%d]" % index, pointer.cast(value_type.pointer()).dereference())


class TXQtMapPrinter:
    def __init__(self, value, kind):
        self._value = value
        self._kind = kind
        self._data = value["d"].dereference()
        self._size = checked_size(self._data["size"])

    def to_string(self):
        return "size = %d" % self._size

    def display_hint(self):
        return "map"

    def children(self):
        if not self._size:
            return
        prefix = type_prefix(self._value)
        if self._kind in ("QHash", "QMultiHash"):
            iterator = self._hash_nodes(prefix)
        else:
            iterator = self._map_nodes(prefix)
        for index, node in enumerate(iterator):
            yield ("key%d" % index, node["key"])
            yield ("value%d" % index, node["value"])

    def _map_nodes(self, prefix):
        arguments = str(self._value.type.strip_typedefs().unqualified()).split("<", 1)[1]
        try:
            node_type = _lookup_struct_type(prefix + "QMapNode<" + arguments)
        except RuntimeError:
            for node in self._numeric_map_nodes(prefix):
                yield node
            return
        link_type = gdb.lookup_type(prefix + "QMapData::Node").pointer()
        byte_type = gdb.lookup_type("char").pointer()
        try:
            payload_type = _lookup_struct_type(prefix + "QMapPayloadNode<" + arguments)
            offset = payload_type.sizeof - link_type.sizeof
        except RuntimeError:
            # sizeof(Node) - two pointers is wrong when PayloadNode has tail padding.
            offset = self._numeric_map_layout()[3]
        current = self._data["forward"][0].cast(link_type)
        seen = set()
        for index in range(self._size):
            address = pointer_address(current)
            if address == pointer_address(self._value["d"]) or address in seen:
                raise ValueError("invalid or cyclic QMap chain")
            seen.add(address)
            yield (current.cast(byte_type) - offset).cast(node_type.pointer()).dereference()
            current = current.dereference()["forward"][0]

    def _numeric_map_nodes(self, prefix):
        key_type, value_type, value_offset, payload = self._numeric_map_layout()
        link_type = gdb.lookup_type(prefix + "QMapData::Node").pointer()
        current = self._data["forward"][0].cast(link_type)
        seen = set()
        for index in range(self._size):
            address = pointer_address(current)
            if address == pointer_address(self._value["d"]) or address in seen:
                raise ValueError("invalid or cyclic QMap chain")
            seen.add(address)
            base = current.cast(gdb.lookup_type("char").pointer()) - payload
            yield {"key": base.cast(key_type.pointer()).dereference(), "value": (base + value_offset).cast(value_type.pointer()).dereference()}
            current = current.dereference()["forward"][0]

    def _numeric_map_layout(self):
        if gdb.lookup_type("void").pointer().sizeof != 4:
            raise ValueError("Qt map node debug type is missing")
        container_type = self._value.type.strip_typedefs().unqualified()
        key_type = container_type.template_argument(0)
        value_type = container_type.template_argument(1)
        key_alignment = _mingw_value_alignment(key_type)
        value_alignment = _mingw_value_alignment(value_type)
        value_offset = _aligned_size(key_type.sizeof, value_alignment)
        node_alignment = max(key_alignment, value_alignment, 4)
        payload = _aligned_size(value_offset + value_type.sizeof + 4, node_alignment) - 4
        return (key_type, value_type, value_offset, payload)

    def _hash_nodes(self, prefix):
        arguments = str(self._value.type.strip_typedefs().unqualified()).split("<", 1)[1]
        node_type = _lookup_struct_type(prefix + "QHashNode<" + arguments).pointer()
        sentinel = pointer_address(self._value["d"])
        bucket_count = checked_size(self._data["numBuckets"])
        seen = set()
        for bucket in range(bucket_count):
            current = self._data["buckets"][bucket].cast(node_type)
            while pointer_address(current) != sentinel:
                address = pointer_address(current)
                if not address or address in seen:
                    raise ValueError("invalid or cyclic QHash chain")
                seen.add(address)
                node = current.dereference()
                yield node
                if len(seen) >= self._size:
                    return
                current = node["next"]
