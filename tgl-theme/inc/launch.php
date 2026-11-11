<?php
/**
 * TGL launch pages (website launch package, 11 Nov 2026).
 *
 * The ten pages in tgl-theme/launch/pages are served whole by this file: a WordPress page whose slug matches an
 * entry in launch/pages.json is rendered from the package (shared header and footer parts, per-page CSS and JS,
 * self-hosted fonts), not from its block content. The page's WordPress content can stay empty.
 *
 * Form endpoints come from wp-config constants when defined and otherwise from the defaults below (they are
 * public URLs, not secrets), so no wp-config edit is needed to go live.
 *
 * @package TGL_Theme
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

const TGL_LAUNCH_DEFAULT_AEO_ENDPOINT        = 'https://tgl-growth-os-production.up.railway.app/aeo/lead';
const TGL_LAUNCH_DEFAULT_AUTOMATION_ENDPOINT = 'https://tgl-growth-os-production.up.railway.app/automation/lead';
const TGL_LAUNCH_DEFAULT_STATS_ENDPOINT      = 'https://tgl-growth-os-production.up.railway.app/home/stats';

/** The page entries from launch/pages.json keyed by slug. */
function tgl_launch_pages(): array {
	static $pages = null;
	if ( null !== $pages ) {
		return $pages;
	}
	$pages = array();
	$file  = get_theme_file_path( 'launch/pages.json' );
	if ( ! file_exists( $file ) ) {
		return $pages;
	}
	$list = json_decode( (string) file_get_contents( $file ), true );
	if ( ! is_array( $list ) ) {
		return $pages;
	}
	foreach ( $list as $entry ) {
		if ( empty( $entry['slug'] ) ) {
			continue;
		}
		$pages[ $entry['slug'] ] = $entry;
		// A nested URL such as /blog/what-is-aeo is a WordPress page whose slug is the last segment.
		$last = basename( trim( (string) ( $entry['url'] ?? '' ), '/' ) );
		if ( '' !== $last && $last !== $entry['slug'] && ! isset( $pages[ $last ] ) ) {
			$pages[ $last ] = $entry;
		}
	}
	return $pages;
}

/** The launch entry for the current request, or null. */
function tgl_launch_current_entry(): ?array {
	if ( is_admin() || ! ( is_page() || is_front_page() ) ) {
		return null;
	}
	$post = get_queried_object();
	if ( ! $post || empty( $post->post_name ) ) {
		return null;
	}
	$pages = tgl_launch_pages();
	$slug  = $post->post_name;
	// A static front page may carry any slug; serve it as "home" when home is in the package.
	if ( is_front_page() && isset( $pages['home'] ) && (int) get_option( 'page_on_front' ) === (int) $post->ID ) {
		return $pages['home'];
	}
	return $pages[ $slug ] ?? null;
}

/** Serve a launch page from the package instead of the block template. */
function tgl_launch_template_include( string $template ): string {
	$entry = tgl_launch_current_entry();
	if ( ! $entry ) {
		return $template;
	}
	$GLOBALS['tgl_launch_entry'] = $entry;
	return get_theme_file_path( 'inc/launch-render.php' );
}
add_filter( 'template_include', 'tgl_launch_template_include', 99 );

/** Front-end config printed before forms.js. Constants win; defaults otherwise. */
function tgl_launch_config(): array {
	return array(
		'aeoEndpoint'   => defined( 'TGL_AEO_ENDPOINT' ) ? TGL_AEO_ENDPOINT : TGL_LAUNCH_DEFAULT_AEO_ENDPOINT,
		'autoEndpoint'  => defined( 'TGL_AUTOMATION_ENDPOINT' ) ? TGL_AUTOMATION_ENDPOINT : TGL_LAUNCH_DEFAULT_AUTOMATION_ENDPOINT,
		'statsEndpoint' => defined( 'TGL_HOME_STATS_ENDPOINT' ) ? TGL_HOME_STATS_ENDPOINT : TGL_LAUNCH_DEFAULT_STATS_ENDPOINT,
		'thanksUrl'     => defined( 'TGL_THANKS_URL' ) ? TGL_THANKS_URL : '/thank-you',
	);
}

/** Replace the package tokens in a fragment and apply the few launch-time rules. */
function tgl_launch_fill( string $html, array $entry ): string {
	$assets = get_theme_file_uri( 'launch/assets' );
	$html   = str_replace( '%ASSETS%', esc_url( $assets ), $html );
	$html   = str_replace( '%PAGE_NOTE%', esc_html( (string) ( $entry['footer_note'] ?? '' ) ), $html );
	// Guided-tour and below-the-fold images load lazily (performance item 2 of the handoff).
	$html = preg_replace( '#<img((?:(?!loading=)[^>])*?)src="([^"]*/img/(?:tour-[a-z]+|board-pub|matrix|founder)\.webp)"#', '<img$1loading="lazy" decoding="async" src="$2"', $html );
	// Until the new privacy page is published, the footer points at the existing policy.
	if ( ! tgl_launch_page_is_published( 'privacy' ) ) {
		$html = str_replace( 'href="/privacy"', 'href="/privacy-policy"', $html );
	}
	return $html;
}

function tgl_launch_page_is_published( string $slug ): bool {
	$page = get_page_by_path( $slug );
	return $page instanceof WP_Post && 'publish' === $page->post_status;
}

/** Version string for cache-busting a package asset. */
function tgl_launch_asset_version( string $relative ): string {
	$path = get_theme_file_path( 'launch/assets/' . $relative );
	return file_exists( $path ) ? (string) filemtime( $path ) : wp_get_theme()->get( 'Version' );
}

/** Nothing from the block theme's front-end styling should load on launch pages. */
function tgl_launch_strip_block_assets(): void {
	if ( ! tgl_launch_current_entry() ) {
		return;
	}
	remove_action( 'wp_enqueue_scripts', 'wp_enqueue_global_styles' );
	remove_action( 'wp_footer', 'wp_enqueue_global_styles', 1 );
	remove_action( 'wp_body_open', 'wp_global_styles_render_svg_filters' );
	wp_dequeue_style( 'wp-block-library' );
	wp_dequeue_style( 'wp-block-library-theme' );
	wp_dequeue_style( 'global-styles' );
	wp_dequeue_style( 'classic-theme-styles' );
	wp_dequeue_style( 'tgl-theme-style' );
	wp_dequeue_style( 'tgl-styles' );
}
add_action( 'wp_enqueue_scripts', 'tgl_launch_strip_block_assets', 100 );

/** Title and description from pages.json; noindex where the package says so. */
function tgl_launch_document_title( string $title ): string {
	$entry = tgl_launch_current_entry();
	return $entry && ! empty( $entry['title'] ) ? (string) $entry['title'] : $title;
}
add_filter( 'pre_get_document_title', 'tgl_launch_document_title', 99 );

function tgl_launch_robots( array $robots ): array {
	$entry = tgl_launch_current_entry();
	if ( $entry && ! empty( $entry['noindex'] ) ) {
		$robots['noindex']  = true;
		$robots['nofollow'] = true;
	}
	return $robots;
}
add_filter( 'wp_robots', 'tgl_launch_robots', 99 );
