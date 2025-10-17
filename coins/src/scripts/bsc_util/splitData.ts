export function splitDataInput(data: any) {
  const result: { [chain: string]: any[] } = {};
  for (const chain of Object.keys(data)) {
    const arr: any[] = [];
    for (const dex of Object.keys(data[chain])) {
      for (const pair of data[chain][dex]) {
        arr.push({
          ...pair,
          dex: dex,
        });
      }
    }
    result[chain] = arr;
  }
  console.log("Split data input:", result);
  return result;
}
