<!-- Do not edit this file. It is automatically generated by API Documenter. -->

[Home](./index.md) &gt; [@holoflows/kit](./kit.md) &gt; [LiveSelector](./kit.liveselector.md) &gt; [querySelectorAll](./kit.liveselector.queryselectorall.md)

## LiveSelector.querySelectorAll() method

Select all element descendants of node that match selectors.

<b>Signature:</b>

```typescript
querySelectorAll<K extends keyof HTMLElementTagNameMap>(selector: K): LiveSelector<HTMLElementTagNameMap[K], SingleMode>;
```

## Parameters

|  Parameter | Type | Description |
|  --- | --- | --- |
|  selector | <code>K</code> | Selector |

<b>Returns:</b>

`LiveSelector<HTMLElementTagNameMap[K], SingleMode>`

## Example


```ts
ls.querySelector('div > div')

```

