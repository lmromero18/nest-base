export interface SelectedDependencies {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

export interface InstallCommand {
  cwd: string;
  args: ['install'];
}

export class BunInstallContract {
  private hasInstalled = false;

  public constructor(
    private readonly run: (command: InstallCommand) => Promise<void>,
  ) {}

  public async install(
    cwd: string,
    selectedDependencies: SelectedDependencies,
  ): Promise<void> {
    if (this.hasInstalled)
      throw new Error('The install contract allows exactly one install.');
    if (!cwd.trim()) throw new Error('Install target CWD is required.');
    if (!selectedDependencies)
      throw new Error('Selected dependencies are required.');
    this.hasInstalled = true;
    await this.run({ cwd, args: ['install'] });
  }
}
