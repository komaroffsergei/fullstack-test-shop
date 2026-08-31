# ADR-003: Timeout и fallback поставщика

Статус: принято.

Timeout не доказывает отсутствие выдачи. Для пары order/provider создаётся стабильный UUID request. После timeout повторяется тот же provider и UUID. Переключение с A на B допустимо только после однозначного `out_of_stock` или управляемого `5xx-before-issue`. Mapping request→code сохраняется поставщиком до симуляции потери ответа.
