const searchBox = document.querySelector('.search-box');
const searchToggle = searchBox.querySelector('.search-toggle');
const searchInput = searchBox.querySelector('#site-search');

function setSearchOpen(isOpen) {
    searchInput.hidden = !isOpen;
    searchToggle.setAttribute('aria-expanded', String(isOpen));
    searchToggle.setAttribute('aria-label', isOpen ? 'Close search' : 'Open search');

    if (isOpen) {
        searchInput.focus();
    }
}

searchToggle.addEventListener('click', () => {
    setSearchOpen(searchInput.hidden);
});

searchBox.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !searchInput.hidden) {
        setSearchOpen(false);
        searchToggle.focus();
    }
});

document.addEventListener('click', (event) => {
    if (!searchBox.contains(event.target)) {
        setSearchOpen(false);
    }
});
