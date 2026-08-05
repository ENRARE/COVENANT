export function normalizeForwardedArguments(arguments_) {
  return arguments_[0] === "--" ? arguments_.slice(1) : [...arguments_];
}
