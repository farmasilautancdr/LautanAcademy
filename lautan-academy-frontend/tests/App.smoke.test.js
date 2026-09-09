import { describe, it, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { createRouter, createMemoryHistory } from 'vue-router';
import { createTestingPinia } from '@pinia/testing';
import App from '../src/App.vue';
import i18n from '../src/i18n';

describe('App.vue smoke test', () => {
  it('mounts with router+pinia+i18n and renders the unauthenticated router-view', async () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/', component: { template: '<div>stub</div>' } }],
    });
    router.push('/');
    await router.isReady();

    const wrapper = mount(App, {
      global: {
        plugins: [
          router,
          i18n,
          createTestingPinia({ stubActions: true, createSpy: vi.fn }),
        ],
      },
    });

    expect(wrapper.text()).toContain('stub');
  });
});
