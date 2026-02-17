// Set up as ambient module so that the dep does not
// need to be included as a direct dep.
// https://github.com/commander-js/extra-typings/issues/91
declare module 'commander' {
  export * from '@commander-js/extra-typings'
}
