package app.nota.pro.components

import androidx.annotation.DrawableRes
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.size
import androidx.compose.material3.CenterAlignedTopAppBar
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.TopAppBarScrollBehavior
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import app.nota.pro.R
import app.nota.pro.theme.NotaTheme
import app.nota.pro.theme.ThemeMode

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun NotaAppBar(
    modifier: Modifier = Modifier,
    scrollBehavior: TopAppBarScrollBehavior? = null,
    onNavIconPressed: () -> Unit = { },
    title: @Composable () -> Unit,
    actions: @Composable RowScope.() -> Unit = {}
) {
    CenterAlignedTopAppBar(
        modifier = modifier,
        actions = actions,
        title = title,
        scrollBehavior = scrollBehavior,
        colors = TopAppBarDefaults.centerAlignedTopAppBarColors().copy(
            containerColor = NotaTheme.colors.backgroundPrimary,
            titleContentColor = NotaTheme.colors.textPrimary,
        ),
        navigationIcon = {
            NotaIconButton(
                R.drawable.ic_close,
                modifier = Modifier.size(44.dp),
                onClick = onNavIconPressed
            )
        }
    )
}

@Composable
fun NotaDropMenu(
    @DrawableRes resId: Int,
    modifier: Modifier,
    menuItems: @Composable ColumnScope.() -> Unit = {}
) {
    var expanded by remember { mutableStateOf(false) }
    Box {
        NotaIconButton(
            resId,
            modifier = modifier,
            onClick = { expanded = !expanded },
        )
        DropdownMenu(
            expanded = expanded,
            onDismissRequest = { expanded = false }
        ) {
            menuItems()
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Preview
@Composable
fun NotaAppBarPreviewLight() {
    NotaTheme(mode = ThemeMode.Light) {
        NotaAppBar(
            title = { Text("Preview!") },
            actions = {
                NotaDropMenu(R.drawable.ic_more_horizontal, Modifier.size(44.dp))
            },
        )
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Preview
@Composable
fun NotaAppBarPreviewDark() {
    NotaTheme(mode = ThemeMode.Dark) {
        NotaAppBar(
            title = { Text("Preview!") },
            actions = {
                NotaDropMenu(R.drawable.ic_more_horizontal, Modifier.size(44.dp))
            },
        )
    }
}