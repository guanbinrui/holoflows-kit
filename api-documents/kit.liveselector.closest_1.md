<!-- Do not edit this file. It is automatically generated by API Documenter. -->

[Home](./index.md) &gt; [@holoflows/kit](./kit.md) &gt; [LiveSelector](./kit.liveselector.md) &gt; [closest](./kit.liveselector.closest_1.md)

## LiveSelector.closest() method

Reversely select element in the parent

<b>Signature:</b>

```typescript
closest<K extends keyof HTMLElementTagNameMap>(selectors: K): LiveSelector<HTMLElementTagNameMap[K], SingleMode>;
```

## Parameters

|  Parameter | Type | Description |
|  --- | --- | --- |
|  selectors | <code>K</code> |  |

<b>Returns:</b>

`LiveSelector<HTMLElementTagNameMap[K], SingleMode>`

## Example


```ts
ls.closest('div')

```

