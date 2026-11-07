import { QueryClientProvider } from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';
import type { UserManager } from 'oidc-client-ts';
import { useCallback, useMemo } from 'react';
import { AuthProvider } from 'react-oidc-context';
import { createTodoApi } from './api';
import { clearSigninParams, cognitoLogoutUrl } from './auth';
import { RequireAuth } from './components/RequireAuth';
import { TodoPage } from './components/TodoPage';
import type { RuntimeConfig } from './config';
import { TodoApiContext } from './todos';

interface Props {
  readonly config: RuntimeConfig;
  readonly userManager: UserManager;
  readonly queryClient: QueryClient;
}

export function App({ config, userManager, queryClient }: Props) {
  const api = useMemo(
    () =>
      createTodoApi(config.apiUrl, async () => {
        const user = await userManager.getUser();
        return user === null || user.expired === true ? undefined : user.access_token;
      }),
    [config.apiUrl, userManager],
  );

  const signOut = useCallback(() => {
    queryClient.clear();
    void userManager.removeUser().finally(() => {
      window.location.assign(cognitoLogoutUrl(config));
    });
  }, [config, queryClient, userManager]);

  return (
    <AuthProvider userManager={userManager} onSigninCallback={clearSigninParams}>
      <QueryClientProvider client={queryClient}>
        <TodoApiContext.Provider value={api}>
          <RequireAuth>
            <TodoPage onSignOut={signOut} />
          </RequireAuth>
        </TodoApiContext.Provider>
      </QueryClientProvider>
    </AuthProvider>
  );
}
