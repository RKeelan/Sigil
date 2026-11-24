# Code

Inline `code` sits in the text. A fenced block keeps its fences as rows of their own:

```ts
export function greet(name: string): string {
  return `Hello, ${name}!`;
}
```

A fence with no language:

```
plain text
    with its indentation kept
```

Tildes work as well, and can hold backticks:

~~~md
```js
console.log("nested");
```
~~~

An indented block needs no fence:

    four spaces
    make this code

A long line in a block wraps like any other text:

```sh
curl --silent --show-error --location --header "Accept: application/json" --header "User-Agent: demo" https://example.com/api/v1/things?limit=100&offset=200&sort=name
```

- A block inside a list item:

  ```py
  def f(x):
      return x * 2
  ```

> A block inside a quote:
>
> ```json
> { "quoted": true }
> ```

Tabs	are	four	spaces	apart.
