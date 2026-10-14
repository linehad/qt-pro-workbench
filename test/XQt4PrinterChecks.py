import gdb
import json
from XQt4Printers import register_printers


def printer(expression):
    result = gdb.default_visualizer(gdb.parse_and_eval(expression))
    assert result is not None, expression
    return result


def text_value(value):
    text = value.to_string()
    return json.loads(text.decode("utf-8") if isinstance(text, str) else text)


def elements(expression):
    return list(printer(expression).children())


expected = u"Qt \ud55c\uae00 \U0001f600"
assert text_value(printer("sText")) == expected
assert text_value(printer("sAlias")) == expected
assert text_value(printer("sNull")) == u""
assert text_value(printer("sEmpty")) == u""
assert text_value(printer("sEmbedded")) == u"A\0B"
assert text_value(printer("sLong")) == u"x" * 5000
assert text_value(printer("qReference")) == u"\ud55c\uae00"
assert text_value(printer("qCharacter")) == u"\ud55c"
assert text_value(printer("qBytes")) == u"A\0\u00ffB"
assert [int(value) for name, value in elements("qNumbers")] == [11, 22]
assert int(elements("qSmallValues")[0][1]["nValue"]) == 17
assert text_value(gdb.default_visualizer(elements("qNames")[1][1])) == expected
assert text_value(gdb.default_visualizer(elements("qWords")[0][1])) == expected
assert [int(value) for name, value in gdb.default_visualizer(elements("qNested")[0][1]).children()] == [11, 22]
assert sorted(int(value) for name, value in elements("qMap") if name.startswith("value")) == [31, 42]
assert int(elements("qAlignedMap")[1][1]) == 1234567890123
assert sorted(int(value) for name, value in elements("qHash") if name.startswith("value")) == [51, 62]
assert text_value(gdb.default_visualizer(elements("qIntHash")[1][1])) == expected
for expression in ("qEmptyList", "qEmptyMap", "qEmptyHash"):
    assert elements(expression) == [], expression
assert int(elements("qQueue")[0][1]) == 8
assert int(elements("qStack")[0][1]) == 12
assert text_value(printer("qStringVariant")) == expected
assert int(printer("qNumberVariant").to_string()) == 71
assert printer("qInvalidVariant").to_string() == "QVariant(invalid)"
assert len(elements("qListVariant")) == 2
assert text_value(printer("qBytesVariant")) == u"A\0\u00ffB"
variant_map = elements("qMapVariant")
assert text_value(gdb.default_visualizer(variant_map[3][1])) == expected
assert sorted(int(value) for name, value in elements("qMultiMap") if name.startswith("value")) == [1, 2]
assert sorted(int(value) for name, value in elements("qMultiHash") if name.startswith("value")) == [3, 4]
register_printers()
assert len([item for item in gdb.pretty_printers if getattr(item, "_qt_pro_workbench", False)]) == 1
print("QT4_PRINTER_CHECKS_PASSED")
