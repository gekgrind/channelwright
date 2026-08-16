/** Serializes operations so concurrent requests cannot interleave read-modify-write cycles over shared local state. */
export function createSerialQueue() {
  let queue = Promise.resolve();
  return async <T>(operation: () => Promise<T>): Promise<T> => {
    const result = queue.then(operation, operation);
    queue = result.then(() => undefined, () => undefined);
    return result;
  };
}
