package com.atomicblast.android.ui

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Album
import androidx.compose.material.icons.filled.Cloud
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import com.atomicblast.android.ui.components.NowPlayingBar
import com.atomicblast.android.ui.screens.AlbumsScreen
import com.atomicblast.android.ui.screens.CloudScreen
import com.atomicblast.android.ui.screens.DashboardScreen
import com.atomicblast.android.ui.screens.FavoritesScreen
import com.atomicblast.android.ui.screens.NowPlayingScreen
import com.atomicblast.android.ui.screens.SettingsScreen
import com.atomicblast.android.ui.theme.DarkAtomicBlastColors
import com.atomicblast.android.ui.theme.LightAtomicBlastColors
import com.atomicblast.android.ui.theme.LocalAtomicBlastColors
import com.atomicblast.android.ui.theme.AtomicBlastTheme
import com.atomicblast.android.viewmodel.PlayerViewModel

sealed class Screen(val route: String, val label: String, val icon: ImageVector) {
    object Dashboard : Screen("dashboard", "Dashboard", Icons.Default.Home)
    object Albums    : Screen("albums",    "Albums",    Icons.Default.Album)
    object Favorites : Screen("favorites", "Favorites", Icons.Default.Favorite)
    object Cloud     : Screen("cloud",     "Cloud",     Icons.Default.Cloud)
    object Settings  : Screen("settings",  "Settings",  Icons.Default.Settings)
}

@Composable
fun AtomicBlastApp() {
    val vm: PlayerViewModel = viewModel()
    val isDark by vm.isDarkTheme.collectAsState()
    val colors = if (isDark) DarkAtomicBlastColors else LightAtomicBlastColors

    CompositionLocalProvider(LocalAtomicBlastColors provides colors) {
        AtomicBlastTheme(isDark = isDark) {
            val navController = rememberNavController()
            val navBackStackEntry by navController.currentBackStackEntryAsState()
            val currentRoute = navBackStackEntry?.destination?.route
            val isNowPlayingRoute = currentRoute == "nowplaying"

            val navItems = listOf(
                Screen.Dashboard,
                Screen.Albums,
                Screen.Favorites,
                Screen.Cloud,
                Screen.Settings
            )

            Scaffold(
                contentWindowInsets = WindowInsets(0),
                containerColor = colors.bg,
                bottomBar = {
                    if (!isNowPlayingRoute) {
                        Column {
                            NowPlayingBar(vm = vm, onClick = { navController.navigate("nowplaying") })
                            NavigationBar(
                                containerColor = colors.bg,
                                tonalElevation = 0.dp,
                                modifier = Modifier.height(72.dp)
                            ) {
                                navItems.forEach { screen ->
                                    NavigationBarItem(
                                        selected = currentRoute == screen.route,
                                        onClick = {
                                            navController.navigate(screen.route) {
                                                popUpTo(Screen.Dashboard.route) { saveState = true }
                                                launchSingleTop = true
                                                restoreState = true
                                            }
                                        },
                                        icon = { Icon(screen.icon, contentDescription = screen.label, modifier = Modifier.size(22.dp)) },
                                        label = { Text(screen.label.uppercase(), fontSize = 10.sp, fontWeight = FontWeight.Bold) },
                                        colors = NavigationBarItemDefaults.colors(
                                            selectedIconColor = colors.green,
                                            selectedTextColor = colors.green,
                                            unselectedIconColor = colors.textMuted,
                                            unselectedTextColor = colors.textMuted,
                                            indicatorColor = colors.greenDim,
                                        )
                                    )
                                }
                            }
                        }
                    }
                }
            ) { padding ->
                Box(
                    modifier = Modifier
                        .fillMaxSize()
                        .padding(padding)
                ) {
                    NavHost(
                        navController = navController,
                        startDestination = Screen.Dashboard.route,
                        modifier = Modifier.fillMaxSize()
                    ) {
                        composable(Screen.Dashboard.route) {
                            DashboardScreen(vm = vm, navController = navController)
                        }
                        composable(Screen.Albums.route) {
                            AlbumsScreen(vm = vm, navController = navController)
                        }
                        composable(Screen.Favorites.route) {
                            FavoritesScreen(vm = vm, navController = navController)
                        }
                        composable(Screen.Cloud.route) {
                            CloudScreen(vm = vm, navController = navController, startPrefix = "Music/")
                        }
                        composable(
                            route = "cloud_prefix?p={p}",
                            arguments = listOf(navArgument("p") {
                                type = NavType.StringType
                                defaultValue = "Music/"
                            })
                        ) { backStack ->
                            val prefix = backStack.arguments?.getString("p") ?: "Music/"
                            CloudScreen(vm = vm, navController = navController, startPrefix = prefix)
                        }
                        composable(Screen.Settings.route) {
                            SettingsScreen(vm = vm)
                        }
                        composable("nowplaying") {
                            NowPlayingScreen(vm = vm, onBack = {
                                if (!navController.popBackStack()) {
                                    navController.navigate(Screen.Dashboard.route)
                                }
                            })
                        }
                    }
                }
            }
        }
    }
}

