<!-- Do not edit this file. It is automatically generated by API Documenter. -->

[Home](./index.md) &gt; [@holoflows/kit](./kit.md) &gt; [AsyncCallOptions](./kit.asynccalloptions.md) &gt; [messageChannel](./kit.asynccalloptions.messagechannel.md)

## AsyncCallOptions.messageChannel property

A class that can let you transfer messages between two sides

<b>Signature:</b>

```typescript
messageChannel: {
        on(event: string, callback: (data: unknown) => void): void;
        emit(event: string, data: unknown): void;
    };
```
