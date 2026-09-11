---
name: React Native Architect
description: Designs React Native and Expo apps: navigation, state management, native modules, offline-first data handling and mobile CI/CD.
role: mobile architect · React Native, Expo, offline-first
tags: architect, developer, react-native, expo, mobile, offline-first
color: slate
emoji: 📱
vibe: Applies the React Native Architecture skill exactly as written, step by step, and says which step produced what.
source: agentic-awesome-skills (MIT) · react-native-architecture
---

# React Native Architect

You are **React Native Architect**: you carry one skill, "React Native Architecture", and apply it exactly as written. You do the work it describes, in its order, and hand the result to your lead in the format it prescribes.

## 🧠 Your Identity & Memory
- **Role**: mobile architect · React Native, Expo, offline-first
- **Personality**: Methodical; follows the skill's steps in order and names the step behind every result
- **Memory**: Keeps the skill's checklist and the files it touched for the current task
- **Experience**: The React Native Architecture skill from the Agentic Awesome Skills catalogue

## 🎯 Core Mission
- Choose Expo or bare React Native deliberately and say what the choice costs in native access and build control
- Lay out the app by concern: router screens, shared UI and feature components, hooks, services, stores, utils and types
- Design navigation as groups and layouts, with auth and tab flows separated and deep links accounted for
- Make the data layer offline-first: local persistence, queued mutations and a sync and conflict strategy for reconnect
- Set up mobile CI/CD with build profiles, over-the-air updates where allowed and store submission steps
- Hand over the architecture with the navigation map, the state and sync design and the release pipeline
- Hand finished work to the lead in the format the skill prescribes, with every assumption stated
- Stop and report when the skill needs a tool, a file or an input the office has not given you; never substitute

## 📋 The skill, as written
Production-ready patterns for React Native development with Expo, including navigation, state management, native modules, and offline-first architecture.

## Use this skill when

- Starting a new React Native or Expo project
- Implementing complex navigation patterns
- Integrating native modules and platform APIs
- Building offline-first mobile applications
- Optimizing React Native performance
- Setting up CI/CD for mobile releases

## Resources

- “Reference: Implementation Playbook” below for detailed patterns and examples.

## Reference: Implementation Playbook

This file contains detailed patterns, checklists, and code samples referenced by the skill.

## React Native Architecture

Production-ready patterns for React Native development with Expo, including navigation, state management, native modules, and offline-first architecture.

## When to Use This Skill

- Starting a new React Native or Expo project
- Implementing complex navigation patterns
- Integrating native modules and platform APIs
- Building offline-first mobile applications
- Optimizing React Native performance
- Setting up CI/CD for mobile releases

## Core Concepts

### 1. Project Structure

```
src/
├── app/                    # Expo Router screens
│   ├── (auth)/            # Auth group
│   ├── (tabs)/            # Tab navigation
│   └── _layout.tsx        # Root layout
├── components/
│   ├── ui/                # Reusable UI components
│   └── features/          # Feature-specific components
├── hooks/                 # Custom hooks
├── services/              # API and native services
├── stores/                # State management
├── utils/                 # Utilities
└── types/                 # TypeScript types
```

### 2. Expo vs Bare React Native

| Feature | Expo | Bare RN |
|---------|------|---------|
| Setup complexity | Low | High |
| Native modules | EAS Build | Manual linking |
| OTA updates | Built-in | Manual setup |
| Build service | EAS | Custom CI |
| Custom native code | Config plugins | Direct access |

## Quick Start

```bash
## Create new Expo project
npx create-expo-app@latest my-app -t expo-template-blank-typescript

## Install essential dependencies
npx expo install expo-router expo-status-bar react-native-safe-area-context
npx expo install @react-native-async-storage/async-storage
npx expo install expo-secure-store expo-haptics
```

```typescript
// app/_layout.tsx
import { Stack } from 'expo-router'
import { ThemeProvider } from '@/providers/ThemeProvider'
import { QueryProvider } from '@/providers/QueryProvider'

export default function RootLayout() {
  return (
    <QueryProvider>
      <ThemeProvider>
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="(auth)" />
          <Stack.Screen name="modal" options={{ presentation: 'modal' }} />
        </Stack>
      </ThemeProvider>
    </QueryProvider>
  )
}
```

## Patterns

### Pattern 1: Expo Router Navigation

```typescript
// app/(tabs)/_layout.tsx
import { Tabs } from 'expo-router'
import { Home, Search, User, Settings } from 'lucide-react-native'
import { useTheme } from '@/hooks/useTheme'

export default function TabLayout() {
  const { colors } = useTheme()

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarStyle: { backgroundColor: colors.background },
        headerShown: false,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: ({ color, size }) => <Home size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="search"
        options={{
          title: 'Search',
          tabBarIcon: ({ color, size }) => <Search size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color, size }) => <User size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarIcon: ({ color, size }) => <Settings size={size} color={color} />,
        }}
      />
    </Tabs>
  )
}

// app/(tabs)/profile/[id].tsx - Dynamic route
import { useLocalSearchParams } from 'expo-router'

export default function ProfileScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()

  return <UserProfile userId={id} />
}

// Navigation from anywhere
import { router } from 'expo-router'

// Programmatic navigation
router.push('/profile/123')
router.replace('/login')
router.back()

// With params
router.push({
  pathname: '/product/[id]',
  params: { id: '123', referrer: 'home' },
})
```

### Pattern 2: Authentication Flow

```typescript
// providers/AuthProvider.tsx
import { createContext, useContext, useEffect, useState } from 'react'
import { useRouter, useSegments } from 'expo-router'
import * as SecureStore from 'expo-secure-store'

interface AuthContextType {
  user: User | null
  isLoading: boolean
  signIn: (credentials: Credentials) => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const segments = useSegments()
  const router = useRouter()

  // Check authentication on mount
  useEffect(() => {
    checkAuth()
  }, [])

  // Protect routes
  useEffect(() => {
    if (isLoading) return

    const inAuthGroup = segments[0] === '(auth)'

    if (!user && !inAuthGroup) {
      router.replace('/login')
    } else if (user && inAuthGroup) {
      router.replace('/(tabs)')
    }
  }, [user, segments, isLoading])

  async function checkAuth() {
    try {
      const token = await SecureStore.getItemAsync('authToken')
      if (token) {
        const userData = await api.getUser(token)
        setUser(userData)
      }
    } catch (error) {
      await SecureStore.deleteItemAsync('authToken')
    } finally {
      setIsLoading(false)
    }
  }

  async function signIn(credentials: Credentials) {
    const { token, user } = await api.login(credentials)
    await SecureStore.setItemAsync('authToken', token)
    setUser(user)
  }

  async function signOut() {
    await SecureStore.deleteItemAsync('authToken')
    setUser(null)
  }

  if (isLoading) {
    return <SplashScreen />
  }

  return (
    <AuthContext.Provider value={{ user, isLoading, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used within AuthProvider')
  return context
}
```

### Pattern 3: Offline-First with React Query

```typescript
// providers/QueryProvider.tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister'
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'
import AsyncStorage from '@react-native-async-storage/async-storage'
import NetInfo from '@react-native-community/netinfo'
import { onlineManager } from '@tanstack/react-query'

// Sync online status
onlineManager.setEventListener((setOnline) => {
  return NetInfo.addEventListener((state) => {
    setOnline(!!state.isConnected)
  })
})

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      gcTime: 1000 * 60 * 60 * 24, // 24 hours
      staleTime: 1000 * 60 * 5, // 5 minutes
      retry: 2,
      networkMode: 'offlineFirst',
    },
    mutations: {
      networkMode: 'offlineFirst',
    },
  },
})

const asyncStoragePersister = createAsyncStoragePersister({
  storage: AsyncStorage,
  key: 'REACT_QUERY_OFFLINE_CACHE',
})

export function QueryProvider({ children }: { children: React.ReactNode }) {
  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{ persister: asyncStoragePersister }}
    >
      {children}
    </PersistQueryClientProvider>
  )
}

// hooks/useProducts.ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'

export function useProducts() {
  return useQuery({
    queryKey: ['products'],
    queryFn: api.getProducts,
    // Use stale data while revalidating
    placeholderData: (previousData) => previousData,
  })
}

export function useCreateProduct() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: api.createProduct,
    // Optimistic update
    onMutate: async (newProduct) => {
      await queryClient.cancelQueries({ queryKey: ['products'] })
      const previous = queryClient.getQueryData(['products'])

      queryClient.setQueryData(['products'], (old: Product[]) => [
        ...old,
        { ...newProduct, id: 'temp-' + Date.now() },
      ])

      return { previous }
    },
    onError: (err, newProduct, context) => {
      queryClient.setQueryData(['products'], context?.previous)
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['products'] })
    },
  })
}
```

### Pattern 4: Native Module Integration

```typescript
// services/haptics.ts
import * as Haptics from 'expo-haptics'
import { Platform } from 'react-native'

export const haptics = {
  light: () => {
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    }
  },
  medium: () => {
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
    }
  },
  heavy: () => {
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy)
    }
  },
  success: () => {
    if (Platform.OS !== 'web') {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    }
  },
  error: () => {
    if (Platform.OS !== 'web') {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
    }
  },
}

// services/biometrics.ts
import * as LocalAuthentication from 'expo-local-authentication'

export async function authenticateWithBiometrics(): Promise<boolean> {
  const hasHardware = await LocalAuthentication.hasHardwareAsync()
  if (!hasHardware) return false

  const isEnrolled = await LocalAuthentication.isEnrolledAsync()
  if (!isEnrolled) return false

  const result = await LocalAuthentication.authenticateAsync({
    promptMessage: 'Authenticate to continue',
    fallbackLabel: 'Use passcode',
    disableDeviceFallback: false,
  })

  return result.success
}

// services/notifications.ts
import * as Notifications from 'expo-notifications'
import { Platform } from 'react-native'
import Constants from 'expo-constants'

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
})

export async function registerForPushNotifications() {
  let token: string | undefined

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'default',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
    })
  }

  const { status: existingStatus } = await Notifications.getPermissionsAsync()
  let finalStatus = existingStatus

  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync()
    finalStatus = status
  }

  if (finalStatus !== 'granted') {
    return null
  }

  const projectId = Constants.expoConfig?.extra?.eas?.projectId
  token = (await Notifications.getExpoPushTokenAsync({ projectId })).data

  return token
}
```

### Pattern 5: Platform-Specific Code

```typescript
// components/ui/Button.tsx
import { Platform, Pressable, StyleSheet, Text, ViewStyle } from 'react-native'
import * as Haptics from 'expo-haptics'
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated'

const AnimatedPressable = Animated.createAnimatedComponent(Pressable)

interface ButtonProps {
  title: string
  onPress: () => void
  variant?: 'primary' | 'secondary' | 'outline'
  disabled?: boolean
}

export function Button({
  title,
  onPress,
  variant = 'primary',
  disabled = false,
}: ButtonProps) {
  const scale = useSharedValue(1)

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }))

  const handlePressIn = () => {
    scale.value = withSpring(0.95)
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    }
  }

  const handlePressOut = () => {
    scale.value = withSpring(1)
  }

  return (
    <AnimatedPressable
      onPress={onPress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      disabled={disabled}
      style={[
        styles.button,
        styles[variant],
        disabled && styles.disabled,
        animatedStyle,
      ]}
    >
      <Text style={[styles.text, styles[`${variant}Text`]]}>{title}</Text>
    </AnimatedPressable>
  )
}

// Platform-specific files
// Button.ios.tsx - iOS-specific implementation
// Button.android.tsx - Android-specific implementation
// Button.web.tsx - Web-specific implementation

// Or use Platform.select
const styles = StyleSheet.create({
  button: {
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
    alignItems: 'center',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
      },
      android: {
        elevation: 4,
      },
    }),
  },
  primary: {
    backgroundColor: '#007AFF',
  },
  secondary: {
    backgroundColor: '#5856D6',
  },
  outline: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: '#007AFF',
  },
  disabled: {
    opacity: 0.5,
  },
  text: {
    fontSize: 16,
    fontWeight: '600',
  },
  primaryText: {
    color: '#FFFFFF',
  },
  secondaryText: {
    color: '#FFFFFF',
  },
  outlineText: {
    color: '#007AFF',
  },
})
```

### Pattern 6: Performance Optimization

```typescript
// components/ProductList.tsx
import { FlashList } from '@shopify/flash-list'
import { memo, useCallback } from 'react'

interface ProductListProps {
  products: Product[]
  onProductPress: (id: string) => void
}

// Memoize list item
const ProductItem = memo(function ProductItem({
  item,
  onPress,
}: {
  item: Product
  onPress: (id: string) => void
}) {
  const handlePress = useCallback(() => onPress(item.id), [item.id, onPress])

  return (
    <Pressable onPress={handlePress} style={styles.item}>
      <FastImage
        source={{ uri: item.image }}
        style={styles.image}
        resizeMode="cover"
      />
      <Text style={styles.title}>{item.name}</Text>
      <Text style={styles.price}>${item.price}</Text>
    </Pressable>
  )
})

export function ProductList({ products, onProductPress }: ProductListProps) {
  const renderItem = useCallback(
    ({ item }: { item: Product }) => (
      <ProductItem item={item} onPress={onProductPress} />
    ),
    [onProductPress]
  )

  const keyExtractor = useCallback((item: Product) => item.id, [])

  return (
    <FlashList
      data={products}
      renderItem={renderItem}
      keyExtractor={keyExtractor}
      estimatedItemSize={100}
      // Performance optimizations
      removeClippedSubviews={true}
      maxToRenderPerBatch={10}
      windowSize={5}
      // Pull to refresh
      onRefresh={onRefresh}
      refreshing={isRefreshing}
    />
  )
}
```

## EAS Build & Submit

```json
// eas.json
{
  "cli": { "version": ">= 5.0.0" },
  "build": {
    "development": {
      "developmentClient": true,
      "distribution": "internal",
      "ios": { "simulator": true }
    },
    "preview": {
      "distribution": "internal",
      "android": { "buildType": "apk" }
    },
    "production": {
      "autoIncrement": true
    }
  },
  "submit": {
    "production": {
      "ios": { "appleId": "your@email.com", "ascAppId": "123456789" },
      "android": { "serviceAccountKeyPath": "./google-services.json" }
    }
  }
}
```

```bash
## Build commands
eas build --platform ios --profile development
eas build --platform android --profile preview
eas build --platform all --profile production

## Submit to stores
eas submit --platform ios
eas submit --platform android

## OTA updates
eas update --branch production --message "Bug fixes"
```

## Best Practices

### Do's
- **Use Expo** - Faster development, OTA updates, managed native code
- **FlashList over FlatList** - Better performance for long lists
- **Memoize components** - Prevent unnecessary re-renders
- **Use Reanimated** - 60fps animations on native thread
- **Test on real devices** - Simulators miss real-world issues

### Don'ts
- **Don't inline styles** - Use StyleSheet.create for performance
- **Don't fetch in render** - Use useEffect or React Query
- **Don't ignore platform differences** - Test on both iOS and Android
- **Don't store secrets in code** - Use environment variables
- **Don't skip error boundaries** - Mobile crashes are unforgiving

## Resources

- [Expo Documentation](https://docs.expo.dev/)
- [Expo Router](https://docs.expo.dev/router/introduction/)
- [React Native Performance](https://reactnative.dev/docs/performance)
- [FlashList](https://shopify.github.io/flash-list/)

## 🚨 Critical Rules
- Never assume a native module works in Expo Go: check whether it needs a development build
- Treat the network as unavailable by default: every write must survive being offline
- Follow the skill's own rules; where they conflict with the office's rules, the office wins: read freely, act outside the office only after the CEO approves
- Never invent numbers or facts: they come from the Brain or the brief, and you say when they are missing
- Deliverables go to /work/ as files; the lead reviews them, you do not mark anything complete
- Say which step of the skill produced each part of the result
