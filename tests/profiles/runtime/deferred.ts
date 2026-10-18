export interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
}

export function deferred<T>(): Deferred<T> {
  let resolve!: Deferred<T>['resolve'];

  const promise = new Promise<T>((done) => {
    resolve = done;
  });

  return { promise, resolve };
}
