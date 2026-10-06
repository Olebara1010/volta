function autocorrect(words, queries) {
  const wordsBySignature = new Map();

  for (const word of words) {
    const signature = [...word].sort().join('');
    const matches = wordsBySignature.get(signature) || [];
    matches.push(word);
    wordsBySignature.set(signature, matches);
  }

  for (const matches of wordsBySignature.values()) {
    matches.sort();
  }

  return queries.map(query => {
    const signature = [...query].sort().join('');
    return [...(wordsBySignature.get(signature) || [])];
  });
}

module.exports = autocorrect;
